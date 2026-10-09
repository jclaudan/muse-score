const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  platform: process.platform,
  version: "1.0.0",
});
