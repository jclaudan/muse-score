// Point d'entrée : démarre le serveur.
// L'écoute a lieu à l'import (utilisé par l'app Electron qui importe ce module).
import "dotenv/config";
import { buildApp } from "./app.js";

const { app, config } = await buildApp();
await app.listen({ port: config.port, host: config.host });
