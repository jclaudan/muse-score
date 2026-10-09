import "dotenv/config";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import archiver from "archiver";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import { convertMidiToMusicxml, resolveBinary } from "./musescore.js";
import {
  publishMusicXml,
  soundsliceConfigured,
} from "./soundslice.js";

const PORT = Number(process.env.PORT ?? 8000);

const app = Fastify({ logger: true });
await app.register(multipart, {
  limits: { fileSize: 20 * 1024 * 1024, files: 20 },
});

app.get("/health", async () => {
  try {
    const bin = await resolveBinary();
    return { ok: true, binary: bin, soundslice: soundsliceConfigured() };
  } catch (e) {
    return {
      ok: false,
      error: (e as Error).message,
      soundslice: soundsliceConfigured(),
    };
  }
});

// POST /convert — 1 fichier MIDI (champ "file") -> 1 .musicxml en download
app.post("/convert", async (req, reply) => {
  const bin = await resolveBinary().catch((e) => {
    reply.code(500);
    throw e;
  });
  const part = await req.file();
  if (!part) return reply.code(400).send({ error: 'Champ "file" manquant' });
  if (!/\.(mid|midi)$/i.test(part.filename)) {
    return reply.code(400).send({ error: "Fichier .mid / .midi attendu" });
  }

  const buf = await part.toBuffer();
  if (buf.length === 0) {
    return reply.code(400).send({ error: "Fichier MIDI vide (0 octet)" });
  }
  const tmp = await mkdtemp(join(tmpdir(), "mscore-"));
  // Noms sûrs ASCII : le nom d'origine ne sert que pour le download
  const inPath = join(tmp, "input.mid");
  const base =
    parse(part.filename).name.replace(/[^\w-]+/g, "_").slice(0, 80) ||
    "output";
  const outPath = join(tmp, "output.musicxml");
  await writeFile(inPath, buf);

  try {
    await convertMidiToMusicxml(bin, inPath, outPath);
    const xml = await readFile(outPath);
    return reply
      .header("Content-Type", "application/vnd.recordare.musicxml+xml")
      .header(
        "Content-Disposition",
        `attachment; filename="${base}.musicxml"`,
      )
      .send(xml);
  } catch (e) {
    req.log.error(e);
    return reply
      .code(500)
      .send({ error: "Échec conversion MuseScore", details: (e as Error).message });
  }
});

// POST /convert-batch — N fichiers MIDI (champ "files") -> 1 .zip de .musicxml
app.post("/convert-batch", async (req, reply) => {
  const bin = await resolveBinary().catch((e) => {
    reply.code(500);
    throw e;
  });
  const parts = req.files();
  const results: { name: string; path: string }[] = [];
  const failures: { file: string; reason: string }[] = [];

  for await (const part of parts) {
    if (!/\.(mid|midi)$/i.test(part.filename)) {
      await part.toBuffer().catch(() => null);
      continue; // ignore les non-MIDI
    }
    const buf = await part.toBuffer();
    if (buf.length === 0) {
      failures.push({ file: part.filename, reason: "fichier vide" });
      continue;
    }
    const tmp = await mkdtemp(join(tmpdir(), "mscore-"));
    const inPath = join(tmp, "input.mid");
    const base =
      parse(part.filename).name.replace(/[^\w-]+/g, "_").slice(0, 80) ||
      "output";
    const outPath = join(tmp, "output.musicxml");
    await writeFile(inPath, buf);
    try {
      await convertMidiToMusicxml(bin, inPath, outPath);
      results.push({ name: `${base}.musicxml`, path: outPath });
    } catch (e) {
      req.log.error({ file: part.filename, e });
      failures.push({ file: part.filename, reason: (e as Error).message });
    }
  }

  if (results.length === 0) {
    const reason =
      failures.length > 0
        ? failures.map((f) => `${f.file}: ${f.reason}`).join(" | ")
        : 'Aucun .mid/.midi dans le champ "files"';
    return reply.code(500).send({ error: "Aucune conversion réussie", details: reason });
  }

  reply.header("Content-Type", "application/zip");
  reply.header("Content-Disposition", 'attachment; filename="musicxml.zip"');
  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.on("error", (err) => reply.send(err));
  archive.pipe(reply.raw);
  for (const r of results) archive.file(r.path, { name: r.name });
  await archive.finalize();
});

// POST /publish-soundslice — .mid/.midi/.musicxml (champ "file", + "name"/"artist"
// optionnels) -> convertit si besoin puis publie sur Soundslice -> { scorehash, url }
app.post("/publish-soundslice", async (req, reply) => {
  if (!soundsliceConfigured()) {
    return reply.code(503).send({
      error: "Soundslice non configuré (SOUNDSLICE_APP_ID / SOUNDSLICE_PASSWORD manquants)",
    });
  }
  let buf: Buffer | null = null;
  let filename = "output";
  const fields: Record<string, string> = {};
  for await (const part of req.parts()) {
    if (part.type === "file") {
      buf = await part.toBuffer();
      filename = part.filename;
    } else {
      fields[part.fieldname] =
        typeof part.value === "string" ? part.value : String(part.value);
    }
  }
  if (!buf || buf.length === 0) {
    return reply.code(400).send({ error: 'Champ "file" manquant ou vide' });
  }

  const base =
    (fields.name ||
      parse(filename).name.replace(/[^\w-]+/g, "_").slice(0, 80) ||
      "output").slice(0, 255);
  const artist = (fields.artist ?? "").slice(0, 255);
  const isMidi = /\.(mid|midi)$/i.test(filename);
  const isXml = /\.(musicxml|xml)$/i.test(filename);
  if (!isMidi && !isXml) {
    return reply
      .code(400)
      .send({ error: "Fichier .mid / .midi / .musicxml attendu" });
  }

  try {
    let xml: Buffer;
    if (isXml) {
      xml = buf;
    } else {
      const bin = await resolveBinary().catch((e) => {
        reply.code(500);
        throw e;
      });
      const tmp = await mkdtemp(join(tmpdir(), "mscore-"));
      const inPath = join(tmp, "input.mid");
      const outPath = join(tmp, "output.musicxml");
      await writeFile(inPath, buf);
      await convertMidiToMusicxml(bin, inPath, outPath);
      xml = await readFile(outPath);
    }
    const res = await publishMusicXml({ name: base, artist, xml });
    return reply.send(res);
  } catch (e) {
    req.log.error(e);
    return reply
      .code(500)
      .send({ error: "Échec publication Soundslice", details: (e as Error).message });
  }
});

// UI drag & drop : http://localhost:8000/
app.get("/", async (_, reply) => {
  return reply.type("text/html").send(`<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MIDI → MusicXML</title>
<style>
*{box-sizing:border-box}body{font-family:system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem;background:#111;color:#eee}
#drop{border:2px dashed #666;border-radius:12px;padding:3rem 1rem;text-align:center;cursor:pointer;transition:.2s}
#drop.over{border-color:#4ade80;background:#14231a}
.row{display:flex;justify-content:space-between;align-items:center;gap:.5rem;padding:.5rem .75rem;background:#1c1c1c;border-radius:8px;margin-top:.5rem}
button{background:#4ade80;border:0;border-radius:8px;padding:.5rem 1rem;font-weight:600;cursor:pointer}
button.ghost{background:#333;color:#fff}
a.dl{color:#4ade80}.err{color:#f87171}.ok{color:#4ade80}
#bar{display:flex;gap:.5rem;margin:1rem 0;flex-wrap:wrap}
#health{font-size:.85rem;opacity:.8}
</style></head><body>
<h1>MIDI → MusicXML</h1>
<div id="health">Vérification MuseScore…</div>
<div id="drop">Dépose tes fichiers <b>.mid / .midi</b> ici<br>ou clique pour sélectionner<input id="input" type="file" accept=".mid,.midi,audio/midi" multiple hidden></div>
<div id="bar">
<button id="all">Tout convertir</button>
<button id="zip" class="ghost">Tout télécharger (.zip)</button>
<button id="clear" class="ghost">Effacer</button>
</div>
<div id="list"></div>
<script>
const drop=document.getElementById('drop'),input=document.getElementById('input'),
list=document.getElementById('list'),files=new Map();
let soundslice=false;
fetch('/health').then(r=>r.json()).then(h=>{
 document.getElementById('health').textContent=(h.ok?'MuseScore OK : '+h.binary:'ERREUR : '+h.error)+(h.soundslice?' | Soundslice OK':' | Soundslice non configuré');
 soundslice=!!h.soundslice;render();
});
drop.onclick=()=>input.click();
['dragover','dragenter'].forEach(e=>drop.addEventListener(e,ev=>{ev.preventDefault();drop.classList.add('over')}));
['dragleave','drop'].forEach(e=>drop.addEventListener(e,ev=>{ev.preventDefault();drop.classList.remove('over')}));
drop.addEventListener('drop',ev=>addFiles(ev.dataTransfer.files));
input.onchange=()=>{addFiles(input.files);input.value=''};
function addFiles(fl){for(const f of fl){if(!/\\.(mid|midi)$/i.test(f.name))continue;const id=crypto.randomUUID();files.set(id,{file:f,url:null,sliceUrl:null,status:'en attente'});render();convertOne(id);}}
function render(){
 list.innerHTML='';
 for(const [id,e] of files){
  const div=document.createElement('div');div.className='row';
  div.innerHTML='<span>'+e.file.name+' — <b class="'+(e.status==='OK'?'ok':e.status.startsWith('erreur')?'err':'')+'">'+e.status+'</b></span>';
  const s=document.createElement('span');
  if(e.url){const a=document.createElement('a');a.href=e.url;a.download=e.file.name.replace(/\\.(mid|midi)$/i,'.musicxml');a.textContent='Télécharger .musicxml';a.className='dl';s.appendChild(a);s.appendChild(document.createTextNode(' '));}
  if(e.sliceUrl){const a=document.createElement('a');a.href=e.sliceUrl;a.target='_blank';a.textContent='Ouvrir dans Soundslice';a.className='dl';s.appendChild(a);s.appendChild(document.createTextNode(' '));}
  else if(soundslice&&e.url){const b=document.createElement('button');b.className='ghost';b.style.cssText='padding:.25rem .6rem;font-size:.85rem';b.textContent='Soundslice';b.onclick=()=>publishOne(id);s.appendChild(b);}
  list.appendChild(div);div.appendChild(s);
 }
}
 async function convertOne(id){
  const e=files.get(id);if(!e||e.url)return;
  e.status='conversion…';render();
  const fd=new FormData();fd.append('file',e.file);
  try{
   const r=await fetch('/convert',{method:'POST',body:fd});
   if(!r.ok){let msg=await r.text();try{const j=JSON.parse(msg);msg=j.details||j.error||msg;}catch{}throw new Error(msg.slice(0,300));}
   const blob=await r.blob();
   e.url=URL.createObjectURL(blob);e.status='OK';
  }catch(err){e.status='erreur : '+err.message;console.error(err);}
  render();
 }
 async function publishOne(id){
  const e=files.get(id);if(!e||e.sliceUrl)return;
  e.status='envoi Soundslice…';render();
  const fd=new FormData();fd.append('file',e.file);
  try{
   const r=await fetch('/publish-soundslice',{method:'POST',body:fd});
   const t=await r.text();let j={};try{j=JSON.parse(t);}catch{}
   if(!r.ok)throw new Error(((j.details||j.error||t)||'erreur').slice(0,300));
   e.sliceUrl=j.url;e.status='OK';
  }catch(err){e.status='erreur : '+err.message;console.error(err);}
  render();
 }
document.getElementById('all').onclick=()=>{for(const [id,e] of files)if(!e.url&&e.status!=='conversion…')convertOne(id);};
document.getElementById('clear').onclick=()=>{files.clear();render();};
document.getElementById('zip').onclick=async()=>{
 if(!files.size)return;
 const fd=new FormData();for(const e of files.values())fd.append('files',e.file);
 const r=await fetch('/convert-batch',{method:'POST',body:fd});
 if(!r.ok){alert(await r.text());return;}
 const blob=await r.blob(),a=document.createElement('a');
 a.href=URL.createObjectURL(blob);a.download='musicxml.zip';a.click();
};
</script></body></html>`);
});

await app.listen({ port: PORT, host: "0.0.0.0" });
