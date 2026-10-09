import type { FastifyInstance } from "fastify";
import type { Deps } from "../core/usecases.js";
import { toHttp } from "./errors.js";

// Réglages Soundslice (clé jamais renvoyée en clair) + config publique.
export function registerSettings(app: FastifyInstance, deps: Deps): void {
  app.get("/settings", async () => {
    const src = deps.settings.credentialSource();
    return {
      configured: src !== null,
      source: src,
      appId: deps.settings.maskedAppId(),
      donateUrl: deps.settings.donateUrl(),
    };
  });

  app.post("/settings", async (req, reply) => {
    const body = (await req.body) as any;
    const appId = String(body?.appId ?? "").trim();
    const password = String(body?.password ?? "");
    const donate =
      body?.donateUrl !== undefined ? String(body.donateUrl) : undefined;
    if (!appId || !password) {
      return reply
        .code(400)
        .send({ error: 'Champs "appId" et "password" requis' });
    }
    try {
      await deps.settings.save(appId, password, donate);
    } catch (e) {
      const { status, body } = toHttp(e);
      return reply.code(status).send(body);
    }
    const src = deps.settings.credentialSource();
    return {
      configured: src !== null,
      source: src,
      appId: deps.settings.maskedAppId(),
      donateUrl: deps.settings.donateUrl(),
    };
  });

  app.delete("/settings", async () => {
    await deps.settings.clear();
    return {
      configured: false,
      source: null,
      appId: "",
      donateUrl: deps.settings.donateUrl(),
    };
  });

  app.post("/settings/test", async (req, reply) => {
    try {
      const res = await deps.publisher.testConnection();
      return { ok: true, ...res };
    } catch (e) {
      req.log.error(e);
      return reply.code(500).send({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  app.get("/config", async () => ({
    donateUrl: deps.settings.donateUrl(),
  }));
}
