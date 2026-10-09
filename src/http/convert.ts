import archiver from "archiver";
import type { FastifyInstance } from "fastify";
import { convertMany, convertOne } from "../core/usecases.js";
import type { Deps } from "../core/usecases.js";
import { toHttp } from "./errors.js";
import { readUpload } from "./multipart.js";

// POST /convert — 1 fichier MIDI (champ "file") -> 1 .musicxml en download.
// POST /convert-batch — N fichiers (champ "files") -> 1 .zip de .musicxml.
export function registerConvert(app: FastifyInstance, deps: Deps): void {
  app.post("/convert", async (req, reply) => {
    const part = await req.file();
    if (!part) {
      return reply.code(400).send({ error: 'Champ "file" manquant' });
    }
    try {
      const { xml, downloadName } = await convertOne(deps, {
        filename: part.filename,
        buf: await part.toBuffer(),
      });
      return reply
        .header("Content-Type", "application/vnd.recordare.musicxml+xml")
        .header(
          "Content-Disposition",
          `attachment; filename="${downloadName}"`,
        )
        .send(xml);
    } catch (e) {
      req.log.error(e);
      const { status, body } = toHttp(e);
      return reply.code(status).send(body);
    }
  });

  app.post("/convert-batch", async (req, reply) => {
    const { files } = await readUpload(req);
    try {
      const converted = await convertMany(deps, files);
      reply.header("Content-Type", "application/zip");
      reply.header(
        "Content-Disposition",
        'attachment; filename="musicxml.zip"',
      );
      const archive = archiver("zip", { zlib: { level: 9 } });
      archive.on("error", (err) => reply.send(err));
      archive.pipe(reply.raw);
      for (const c of converted) archive.append(c.xml, { name: c.name });
      await archive.finalize();
    } catch (e) {
      req.log.error(e);
      const { status, body } = toHttp(e);
      return reply.code(status).send(body);
    }
  });
}
