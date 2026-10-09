import type { FastifyInstance } from "fastify";
import {
  previewBatch,
  publishBatch,
  publishOne,
} from "../core/usecases.js";
import type { Deps } from "../core/usecases.js";
import { toHttp } from "./errors.js";
import { readUpload } from "./multipart.js";

// POST /publish-soundslice — .mid/.midi/.musicxml (champ "file",
// + "name"/"artist" optionnels) -> { scorehash, url }.
// POST /publish-soundslice-batch — N fichiers (champ "files") +
// artist/listId/embedStatus/dryRun -> récap JSON.
export function registerPublish(app: FastifyInstance, deps: Deps): void {
  app.post("/publish-soundslice", async (req, reply) => {
    const { files, fields } = await readUpload(req);
    const first = files[0];
    if (!first || first.buf.length === 0) {
      return reply
        .code(400)
        .send({ error: 'Champ "file" manquant ou vide' });
    }
    try {
      return reply.send(
        await publishOne(deps, first, {
          name: fields.name,
          artist: fields.artist,
        }),
      );
    } catch (e) {
      req.log.error(e);
      const { status, body } = toHttp(e);
      return reply.code(status).send(body);
    }
  });

  app.post("/publish-soundslice-batch", async (req, reply) => {
    const { files, fields } = await readUpload(req);
    try {
      if (fields.dryRun === "true" || fields.dryRun === "1") {
        return reply.send(previewBatch(files));
      }
      return reply.send(
        await publishBatch(deps, files, {
          artist: fields.artist,
          listId: (fields.listId ?? "").trim() || undefined,
          embedStatus: fields.embedStatus
            ? Number(fields.embedStatus)
            : undefined,
        }),
      );
    } catch (e) {
      req.log.error(e);
      const { status, body } = toHttp(e);
      return reply.code(status).send(body);
    }
  });
}
