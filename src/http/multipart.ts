// Lecture multipart partagée : fichiers + champs texte.
import type { FastifyRequest } from "fastify";
import type { UploadedFile } from "../core/model.js";

export interface Upload {
  files: UploadedFile[];
  fields: Record<string, string>;
}

export async function readUpload(req: FastifyRequest): Promise<Upload> {
  const files: UploadedFile[] = [];
  const fields: Record<string, string> = {};
  for await (const part of req.parts()) {
    if (part.type === "file") {
      files.push({ filename: part.filename, buf: await part.toBuffer() });
    } else {
      fields[part.fieldname] =
        typeof part.value === "string" ? part.value : String(part.value);
    }
  }
  return { files, fields };
}
