// Racine de composition : seul endroit qui connaît à la fois
// le cœur (use-cases), les adaptateurs et le framework HTTP.
// Pour changer d'implémentation (ex : autre convertisseur),
// on ne touche qu'ici.
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { JsonFileStore } from "./adapters/fileStore.js";
import { MuseScoreConverter } from "./adapters/musescore.js";
import { SoundslicePublisher } from "./adapters/soundslice.js";
import { loadConfig, type AppConfig } from "./config.js";
import type { Deps } from "./core/usecases.js";
import { registerConvert } from "./http/convert.js";
import { registerHealth } from "./http/health.js";
import { registerPublish } from "./http/publish.js";
import { registerSettings } from "./http/settings.js";
import { registerUi } from "./http/ui.js";
import { registerWorkflows } from "./http/workflows.js";

export async function buildApp(): Promise<{
  app: ReturnType<typeof Fastify>;
  config: AppConfig;
  deps: Deps;
}> {
  const config = loadConfig();
  const store = await JsonFileStore.open(config.dataDir);
  const converter = new MuseScoreConverter();
  const publisher = new SoundslicePublisher(store);
  const deps: Deps = {
    converter,
    publisher,
    settings: store,
    workflows: store,
    runs: store,
  };

  const app = Fastify({ logger: true });
  await app.register(multipart, {
    limits: { fileSize: 20 * 1024 * 1024, files: 20 },
  });

  registerHealth(app, deps);
  registerConvert(app, deps);
  registerPublish(app, deps);
  registerSettings(app, deps);
  registerWorkflows(app, deps);
  registerUi(app);

  return { app, config, deps };
}
