// Test du cablage main process SANS ecran (Electron moque) :
// boot backend reel -> creation fenetre -> handler window.open -> sante.
// Usage : npm run test:main  (DATA_DIR et PORT configurables via env)
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert");
const Module = require("node:module");

const calls = { handler: null, loadURL: null, shown: false };

class FakeWindow {
  constructor(opts) {
    this.opts = opts;
    this.webContents = {
      setWindowOpenHandler: (h) => {
        calls.handler = h;
      },
    };
  }

  once(ev, cb) {
    if (ev === "ready-to-show") calls.showCb = cb;
  }

  show() {
    calls.shown = true;
  }

  loadURL(url) {
    calls.loadURL = url;
  }
}

const fakeElectron = {
  app: {
    isPackaged: false,
    setName() {},
    getPath: () => os.tmpdir(),
    requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(),
    quit: () => {},
    on() {},
  },
  BrowserWindow: FakeWindow,
  dialog: { showErrorBox: () => {} },
  shell: { openExternal: () => {} },
};

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "electron") return fakeElectron;
  return origLoad.call(this, request, parent, isMain);
};

(async () => {
  process.env.PORT = process.env.TEST_PORT || "8123";
  require("./main.js");
  const t0 = Date.now();
  while (!calls.loadURL && Date.now() - t0 < 90000) {
    await new Promise((r) => setTimeout(r, 250));
  }
  assert.ok(calls.loadURL, "loadURL non appele (backend ou fenetre HS)");
  assert.ok(
    typeof calls.handler === "function",
    "setWindowOpenHandler non enregistre sur webContents",
  );
  assert.deepStrictEqual(calls.handler({ url: "https://example.com/x" }), {
    action: "deny",
  });
  const r = await fetch(calls.loadURL + "/health");
  await r.arrayBuffer();
  assert.ok(r.ok, "backend injoignable");
  if (calls.showCb) calls.showCb();
  assert.ok(calls.shown, "fenetre jamais affichee (ready-to-show)");
  console.log("MAIN-TEST OK:", calls.loadURL);
  await new Promise((r2) => setTimeout(r2, 1000));
  process.exit(0);
})().catch((e) => {
  console.error("MAIN-TEST FAIL:", e.message);
  process.exit(1);
});
