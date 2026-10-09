import type { FastifyInstance } from "fastify";
import type { Deps } from "../core/usecases.js";

// GET /health — état MuseScore + flag Soundslice (aucun secret exposé).
export function registerHealth(app: FastifyInstance, deps: Deps): void {
  app.get("/health", async () => {
    const soundslice = deps.settings.getCredentials() !== null;
    try {
      const binary = await deps.converter.status();
      return { ok: true, binary, soundslice };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        soundslice,
      };
    }
  });
}
