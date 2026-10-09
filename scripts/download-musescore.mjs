// Telecharge MuseScore 4 et extrait le binaire vers resources/bin/<plateforme>/.
// Usage : npm run binaries  (MUSESCORE_VERSION=v4.4.1 pour forcer une version)
// A lancer sur l'OS cible : Windows -> resources/bin/win-x64/, macOS -> resources/bin/mac/.
// Note licence : MuseScore est GPL-3.0 ; en redistribuant le binaire, prevois
// l'offre de sources correspondante dans ton installateur.
import { execFile } from "node:child_process";
import { mkdir, readdir, rm, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execAsync = promisify(execFile);
const VERSION = process.env.MUSESCORE_VERSION ?? "v4.4.4";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(
  ROOT,
  "resources",
  "bin",
  process.platform === "win32" ? "win-x64" : process.platform === "darwin" ? "mac" : "linux",
);
// Noms d'assets verifies (repli si l'API GitHub est injoignable)
const PINNED = {
  win32: "MuseScore-Studio-4.4.4.243461245-x86_64.msi",
  darwin: "MuseScore-Studio-4.4.4.243461245.dmg",
};

async function assetUrl() {
  const isWin = process.platform === "win32";
  const test = isWin ? (n) => /x86_64\.msi$/i.test(n) : (n) => /\.dmg$/i.test(n);
  try {
    const r = await fetch(
      `https://api.github.com/musescore/MuseScore/releases/tags/${VERSION}`,
      { headers: { "User-Agent": "midi-musicxml-desktop" } },
    );
    if (r.ok) {
      const rel = await r.json();
      const hit = rel.assets.find((a) => test(a.name));
      if (hit) return { url: hit.browser_download_url, name: hit.name };
    }
    console.log(`API GitHub indisponible (${r.status}) — repli CDN jsdelivr`);
  } catch (e) {
    console.log(`API GitHub erreur (${e.message}) — repli CDN jsdelivr`);
  }
  const name = process.env.MUSESCORE_ASSET ?? PINNED[process.platform];
  if (!name) throw new Error("Pas d'asset connu pour cette plateforme");
  return { url: `https://cdn.jsdelivr.net/musescore/${VERSION}/${name}`, name };
}

async function download(url, dest) {
  const r = await fetch(url, { headers: { "User-Agent": "midi-musicxml-desktop" } });
  if (!r.ok || !r.body) throw new Error(`Download ${r.status}`);
  const { createWriteStream } = await import("node:fs");
  const { pipeline } = await import("node:stream/promises");
  const { Readable } = await import("node:stream");
  await pipeline(Readable.fromWeb(r.body), createWriteStream(dest));
}

async function findFile(dir, name) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isFile() && e.name === name) return p;
    if (e.isDirectory()) {
      const hit = await findFile(p, name).catch(() => null);
      if (hit) return hit;
    }
  }
  return null;
}

async function main() {
if (process.platform === "win32") {
  const asset = await assetUrl();
  console.log("Asset:", asset.name);
  await mkdir(OUT, { recursive: true });
  const msi = join(OUT, "_dl.msi");
  const tmp = join(OUT, "_dl");
  await download(asset.url, msi);
  await rm(tmp, { recursive: true, force: true });
  await mkdir(tmp, { recursive: true });
  // Extraction sans installation (msiexec integre a Windows).
  // On copie l'arborescence COMPLETE (exe + DLLs Qt + donnees) : l'exe seul ne demarre pas.
  await execAsync("msiexec", ["/a", msi, "/qn", `TARGETDIR=${tmp}`]);
  const exe = await findFile(tmp, "MuseScore4.exe");
  if (!exe) throw new Error("MuseScore4.exe introuvable dans le .msi");
  const appRoot = join(dirname(exe), "..");
  await cp(appRoot, OUT, { recursive: true });
  await rm(msi, { force: true });
  await rm(tmp, { recursive: true, force: true });
  console.log("OK:", join(OUT, "bin", "MuseScore4.exe"));
} else if (process.platform === "darwin") {
  const asset = await assetUrl();
  console.log("Asset:", asset.name);
  await mkdir(OUT, { recursive: true });
  const dmg = join(OUT, "_dl.dmg");
  const mnt = join(OUT, "_mnt");
  await download(asset.url, dmg);
  await rm(mnt, { recursive: true, force: true });
  await mkdir(mnt, { recursive: true });
  await execAsync("hdiutil", ["attach", dmg, "-mountpoint", mnt, "-nobrowse", "-quiet"]);
  try {
    // Bundle COMPLET (.app + Frameworks + Resources) : le binaire seul ne demarre pas.
    // Renomme en app.app pour un chemin stable cote desktop/main.js.
    const entries = await readdir(mnt, { withFileTypes: true });
    const appDir = entries.find((e) => e.isDirectory() && e.name.endsWith(".app"));
    if (!appDir) throw new Error("bundle .app introuvable dans le .dmg");
    await cp(join(mnt, appDir.name), join(OUT, "app.app"), { recursive: true });
  } finally {
    await execAsync("hdiutil", ["detach", mnt, "-quiet"]).catch(() => {});
  }
  await rm(dmg, { force: true });
  await rm(mnt, { recursive: true, force: true });
  console.log("OK:", join(OUT, "app.app", "Contents", "MacOS", "mscore"));
} else {
  console.log("Docker/Linux : binaire deja fourni par l'image (voir Dockerfile). Rien a faire.");
}

if (!existsSync(OUT)) console.log("Rien telecharge.");
}

main().catch((e) => {
  console.error("ERREUR:", e.message);
  process.exit(1);
});
