import { readFile } from "node:fs/promises";
import type { FastifyInstance } from "fastify";

const UI_PATH = new URL("../ui.html", import.meta.url);
let uiCache: string | null = null;

// Page servie depuis src/ui.html (copiée vers dist/ au build).
export function registerUi(app: FastifyInstance): void {
  app.get("/", async (_, reply) => {
    if (!uiCache) uiCache = await readFile(UI_PATH, "utf-8");
    return reply.type("text/html").send(uiCache);
  });
}
