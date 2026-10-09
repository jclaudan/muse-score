import "dotenv/config";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import archiver from "archiver";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import { convertMidiToMusicxml, resolveBinary } from "./musescore.js";
import {
  addSlicesToList,
  publishMusicXml,
  soundsliceConfigured,
  testConnection,
  titleFromMusicXml,
} from "./soundslice.js";
import {
  clearCredentials,
  createWorkflow,
  deleteWorkflow,
  listRuns,
  listWorkflows,
  loadStore,
  maskedSettings,
  pushRun,
  setCredentials,
  updateWorkflow,
  type RunRecord,
} from "./store.js";

const PORT = Number(process.env.PORT ?? 8000);

await loadStore();

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
      error:
        "Soundslice non configuré (réglages de l'interface ou variables SOUNDSLICE_APP_ID / SOUNDSLICE_PASSWORD)",
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
    // Titre : champ "name", sinon <work-title> du MusicXML, sinon nom du fichier
    const title =
      (
        fields.name ||
        titleFromMusicXml(xml) ||
        parse(filename).name
      ).slice(0, 255) || "output";
    const res = await publishMusicXml({ name: title, artist, xml });
    return reply.send(res);
  } catch (e) {
    req.log.error(e);
    return reply
      .code(500)
      .send({ error: "Échec publication Soundslice", details: (e as Error).message });
  }
});

// POST /publish-soundslice-batch — N fichiers (champ "files") + champs
// artist/listId/embedStatus/dryRun -> récap JSON
// { dryRun, results: [{file,title,scorehash,url,embedUrl?}], failures: [{file,reason}] }
app.post("/publish-soundslice-batch", async (req, reply) => {
  const uploads: { filename: string; buf: Buffer }[] = [];
  const fields: Record<string, string> = {};
  for await (const part of req.parts()) {
    if (part.type === "file") {
      uploads.push({ filename: part.filename, buf: await part.toBuffer() });
    } else {
      fields[part.fieldname] =
        typeof part.value === "string" ? part.value : String(part.value);
    }
  }
  const valid = uploads.filter(
    (u) =>
      u.buf.length > 0 && /\.(mid|midi|musicxml|xml)$/i.test(u.filename),
  );
  if (valid.length === 0) {
    return reply
      .code(400)
      .send({ error: 'Aucun .mid/.midi/.musicxml dans le champ "files"' });
  }

  // Titre prévisionnel : <work-title> si MusicXML, sinon nom du fichier
  const previewTitle = (u: { filename: string; buf: Buffer }): string => {
    if (/\.(musicxml|xml)$/i.test(u.filename)) {
      const t = titleFromMusicXml(u.buf);
      if (t) return t;
    }
    return parse(u.filename).name.slice(0, 255) || "output";
  };

  // dry-run : liste les titres sans rien envoyer (config non exigée)
  if (fields.dryRun === "true" || fields.dryRun === "1") {
    return reply.send({
      dryRun: true,
      items: valid.map((u) => ({ file: u.filename, title: previewTitle(u) })),
    });
  }

  if (!soundsliceConfigured()) {
    return reply.code(503).send({
      error:
        "Soundslice non configuré (réglages de l'interface ou variables SOUNDSLICE_APP_ID / SOUNDSLICE_PASSWORD)",
    });
  }
  const artist = (fields.artist ?? "").slice(0, 255);
  const listId = (fields.listId ?? "").trim();
  const embedStatus = fields.embedStatus ? Number(fields.embedStatus) : undefined;
  if (embedStatus !== undefined && ![1, 2, 4].includes(embedStatus)) {
    return reply
      .code(400)
      .send({ error: "embedStatus attendu : 1, 2 ou 4" });
  }

  let bin: string | null = null;
  if (valid.some((u) => /\.(mid|midi)$/i.test(u.filename))) {
    try {
      bin = await resolveBinary();
    } catch (e) {
      return reply.code(500).send({ error: (e as Error).message });
    }
  }

  const results: {
    file: string;
    title: string;
    scorehash: string;
    url: string;
    embedUrl?: string;
  }[] = [];
  const failures: { file: string; reason: string }[] = [];
  for (const u of valid) {
    try {
      let xml: Buffer;
      if (/\.(musicxml|xml)$/i.test(u.filename)) {
        xml = u.buf;
      } else {
        const tmp = await mkdtemp(join(tmpdir(), "mscore-"));
        await writeFile(join(tmp, "input.mid"), u.buf);
        const outPath = join(tmp, "output.musicxml");
        await convertMidiToMusicxml(bin as string, join(tmp, "input.mid"), outPath);
        xml = await readFile(outPath);
      }
      const title = titleFromMusicXml(xml) ?? previewTitle(u);
      const pub = await publishMusicXml({
        name: title,
        artist,
        embedStatus,
        xml,
      });
      results.push({ file: u.filename, title, ...pub });
    } catch (e) {
      req.log.error({ file: u.filename, e });
      failures.push({ file: u.filename, reason: (e as Error).message });
    }
  }

  let listError: string | undefined;
  if (listId && results.length > 0) {
    try {
      await addSlicesToList(
        listId,
        results.map((r) => r.scorehash),
      );
    } catch (e) {
      listError = (e as Error).message;
    }
  }

  return reply.send({
    dryRun: false,
    ...(listId ? { listId } : {}),
    results,
    failures,
    ...(listError ? { listError } : {}),
  });
});

// --- Réglages Soundslice (stockés en local, jamais renvoyés en clair)
app.get("/settings", async () => maskedSettings());

app.post("/settings", async (req, reply) => {
  const body = (await req.body) as any;
  const appId = String(body?.appId ?? "").trim();
  const password = String(body?.password ?? "");
  if (!appId || !password) {
    return reply
      .code(400)
      .send({ error: 'Champs "appId" et "password" requis' });
  }
  await setCredentials(appId, password);
  return maskedSettings();
});

app.delete("/settings", async () => {
  await clearCredentials();
  return maskedSettings();
});

app.post("/settings/test", async (req, reply) => {
  try {
    const res = await testConnection();
    return { ok: true, ...res };
  } catch (e) {
    return reply
      .code(500)
      .send({ ok: false, error: (e as Error).message });
  }
});

// --- Workflows : conversion + publication configurables et rejouables
app.get("/workflows", async () => listWorkflows());

app.post("/workflows", async (req, reply) => {
  try {
    const wf = await createWorkflow(await req.body);
    return reply.code(201).send(wf);
  } catch (e) {
    return reply.code(400).send({ error: (e as Error).message });
  }
});

app.put("/workflows/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  try {
    const wf = await updateWorkflow(id, await req.body);
    if (!wf) return reply.code(404).send({ error: "Workflow introuvable" });
    return wf;
  } catch (e) {
    return reply.code(400).send({ error: (e as Error).message });
  }
});

app.delete("/workflows/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  if (!(await deleteWorkflow(id))) {
    return reply.code(404).send({ error: "Workflow introuvable" });
  }
  return { deleted: true };
});

app.get("/runs", async () => listRuns());

// POST /workflows/:id/run — champ "files" (mid/midi/musicxml) -> exécute le
// workflow (conversion + publication optionnelle) -> récap + historique
app.post("/workflows/:id/run", async (req, reply) => {
  const { id } = req.params as { id: string };
  const wf = listWorkflows().find((w) => w.id === id);
  if (!wf) return reply.code(404).send({ error: "Workflow introuvable" });

  const uploads: { filename: string; buf: Buffer }[] = [];
  const fields: Record<string, string> = {};
  for await (const part of req.parts()) {
    if (part.type === "file") {
      uploads.push({ filename: part.filename, buf: await part.toBuffer() });
    } else {
      fields[part.fieldname] =
        typeof part.value === "string" ? part.value : String(part.value);
    }
  }
  const valid = uploads.filter(
    (u) =>
      u.buf.length > 0 && /\.(mid|midi|musicxml|xml)$/i.test(u.filename),
  );
  if (valid.length === 0) {
    return reply
      .code(400)
      .send({ error: 'Aucun .mid/.midi/.musicxml dans le champ "files"' });
  }

  const dryRun =
    fields.dryRun !== undefined
      ? fields.dryRun === "true" || fields.dryRun === "1"
      : wf.dryRun;
  const previewTitle = (u: { filename: string; buf: Buffer }): string => {
    if (/\.(musicxml|xml)$/i.test(u.filename)) {
      const t = titleFromMusicXml(u.buf);
      if (t) return t;
    }
    return parse(u.filename).name.slice(0, 255) || "output";
  };

  if (dryRun) {
    const record = await pushRun({
      workflowId: wf.id,
      workflowName: wf.name,
      dryRun: true,
      results: [],
      failures: [],
    });
    return reply.send({
      ...record,
      items: valid.map((u) => ({ file: u.filename, title: previewTitle(u) })),
    });
  }

  let bin: string | null = null;
  if (valid.some((u) => /\.(mid|midi)$/i.test(u.filename))) {
    try {
      bin = await resolveBinary();
    } catch (e) {
      return reply.code(500).send({ error: (e as Error).message });
    }
  }
  if (wf.publish && !soundsliceConfigured()) {
    return reply.code(503).send({
      error:
        "Soundslice non configuré (réglages de l'interface ou variables SOUNDSLICE_APP_ID / SOUNDSLICE_PASSWORD)",
    });
  }

  const results: RunRecord["results"] = [];
  const failures: { file: string; reason: string }[] = [];
  for (const u of valid) {
    try {
      let xml: Buffer;
      if (/\.(musicxml|xml)$/i.test(u.filename)) {
        xml = u.buf;
      } else {
        const tmp = await mkdtemp(join(tmpdir(), "mscore-"));
        await writeFile(join(tmp, "input.mid"), u.buf);
        const outPath = join(tmp, "output.musicxml");
        await convertMidiToMusicxml(bin as string, join(tmp, "input.mid"), outPath);
        xml = await readFile(outPath);
      }
      const title = titleFromMusicXml(xml) ?? previewTitle(u);
      if (!wf.publish) {
        results.push({ file: u.filename, title, bytes: xml.length });
        continue;
      }
      const pub = await publishMusicXml({
        name: title,
        artist: wf.artist,
        embedStatus: wf.embedStatus,
        xml,
      });
      results.push({ file: u.filename, title, bytes: xml.length, ...pub });
    } catch (e) {
      req.log.error({ file: u.filename, e });
      failures.push({ file: u.filename, reason: (e as Error).message });
    }
  }

  let listError: string | undefined;
  if (wf.listId && results.some((r) => r.scorehash)) {
    try {
      await addSlicesToList(
        wf.listId,
        results.map((r) => r.scorehash as string),
      );
    } catch (e) {
      listError = (e as Error).message;
    }
  }

  const record = await pushRun({
    workflowId: wf.id,
    workflowName: wf.name,
    dryRun: false,
    results,
    failures,
    ...(listError ? { listError } : {}),
  });
  return reply.send(record);
});

// UI : http://localhost:8000/ (page servie depuis src/ui.html, copiée vers dist/ au build)
const UI_PATH = new URL("./ui.html", import.meta.url);
let uiCache: string | null = null;
app.get("/", async (_, reply) => {
  if (!uiCache) uiCache = await readFile(UI_PATH, "utf-8");
  return reply.type("text/html").send(uiCache);
});

await app.listen({ port: PORT, host: "0.0.0.0" });
