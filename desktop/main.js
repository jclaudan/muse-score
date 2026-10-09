// Main process (CommonJS) : demarre le backend Fastify en-process, puis ouvre la fenetre.
const { app, BrowserWindow, dialog, shell } = require("electron");
const path = require("node:path");
const net = require("node:net");
const { pathToFileURL } = require("node:url");

const isDev = !app.isPackaged;
app.setName("MIDI vers MusicXML");

function backendPath() {
  if (isDev) return path.join(__dirname, "..", "dist", "server.js");
  return path.join(process.resourcesPath, "backend", "server.js");
}

// "Tout embarquer" : binaire MuseScore packagé, sinon installation systeme.
function musescoreBin() {
  if (process.env.MUSESCORE_BIN) return process.env.MUSESCORE_BIN;
  if (!app.isPackaged) return undefined;
  const res = process.resourcesPath;
  if (process.platform === "win32")
    return path.join(res, "bin", "win-x64", "bin", "MuseScore4.exe");
  if (process.platform === "darwin")
    return path.join(res, "bin", "mac", "app.app", "Contents", "MacOS", "mscore");
  return path.join(res, "bin", "linux", "bin", "mscore4portable");
}

function findPort(start, tries = 20) {
  return new Promise((resolve, reject) => {
    const tryOne = (port, left) => {
      const s = net.createServer();
      s.once("error", () =>
        left <= 1 ? reject(new Error("Aucun port libre")) : tryOne(port + 1, left - 1),
      );
      s.listen(port, "127.0.0.1", () => s.close(() => resolve(port)));
    };
    tryOne(start, tries);
  });
}

async function waitHealth(url, timeoutMs = 45000) {
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await fetch(`${url}/health`);
      if (r.ok) return;
    } catch {
      // pas encore pret
    }
    if (Date.now() - t0 > timeoutMs) throw new Error("Backend injoignable");
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function startBackend() {
  const port = await findPort(Number(process.env.PORT ?? 8000));
  process.env.PORT = String(port);
  const bin = musescoreBin();
  if (bin) process.env.MUSESCORE_BIN = bin;
  await import(pathToFileURL(backendPath()).href); // effet : app.listen()
  const url = `http://127.0.0.1:${port}`;
  await waitHealth(url);
  return url;
}

function createWindow(url) {
  const win = new BrowserWindow({
    width: 960,
    height: 760,
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });
  win.setWindowOpenHandler(({ url: u }) => {
    shell.openExternal(u);
    return { action: "deny" };
  });
  win.loadURL(url);
}

if (!app.requestSingleInstanceLock()) app.quit();

app.whenReady().then(async () => {
  const smoke = process.argv.includes("--smoke");
  try {
    const url = await startBackend();
    const health = await (await fetch(`${url}/health`)).json();
    console.log(`BACKEND READY ${url} musescore=${health.ok ? health.binary : "ABSENT:" + health.error}`);
    if (smoke) return app.quit();
    createWindow(url);
  } catch (e) {
    const msg = String(e?.message ?? e);
    if (smoke) {
      console.error("BACKEND FAILED:", msg);
      process.exit(1);
    }
    dialog.showErrorBox("Demarrage impossible", msg);
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
