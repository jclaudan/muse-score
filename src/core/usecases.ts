// Cas d'utilisation : orchestration pure sur les ports.
// Aucune dépendance Fastify, CLI, HTTP ou système de fichiers ici.
import { AppError } from "./errors.js";
import type {
  ConverterPort,
  PublisherPort,
  RunRepository,
  SettingsPort,
  WorkflowRepository,
} from "./ports.js";
import type {
  PublishedFile,
  PublishFailure,
  RunRecord,
  UploadedFile,
  Workflow,
} from "./model.js";
import {
  displayTitle,
  downloadBase,
  isMidiFile,
  isSupportedFile,
  isXmlFile,
} from "./titles.js";

export interface Deps {
  converter: ConverterPort;
  publisher: PublisherPort;
  settings: SettingsPort;
  workflows: WorkflowRepository;
  runs: RunRepository;
}

function requireFile(file: UploadedFile): void {
  if (!file.buf || file.buf.length === 0) {
    throw new AppError("BAD_REQUEST", `Fichier vide : ${file.filename}`);
  }
}

async function toXml(
  deps: Deps,
  file: UploadedFile,
): Promise<Buffer> {
  requireFile(file);
  if (isXmlFile(file.filename)) return file.buf;
  if (!isMidiFile(file.filename)) {
    throw new AppError(
      "BAD_REQUEST",
      `Fichier .mid / .midi / .musicxml attendu : ${file.filename}`,
    );
  }
  return deps.converter.convertMidi(file.buf, file.filename);
}

export function validUploads(files: UploadedFile[]): UploadedFile[] {
  return files.filter((f) => f.buf.length > 0 && isSupportedFile(f.filename));
}

// --- Conversion
export async function convertOne(
  deps: Deps,
  file: UploadedFile,
): Promise<{ xml: Buffer; downloadName: string }> {
  if (!isMidiFile(file.filename)) {
    throw new AppError("BAD_REQUEST", "Fichier .mid / .midi attendu");
  }
  if (!file.buf || file.buf.length === 0) {
    throw new AppError("BAD_REQUEST", "Fichier MIDI vide (0 octet)");
  }
  const xml = await deps.converter.convertMidi(file.buf, file.filename);
  return { xml, downloadName: `${downloadBase(file.filename)}.musicxml` };
}

export async function convertMany(
  deps: Deps,
  files: UploadedFile[],
): Promise<{ name: string; xml: Buffer }[]> {
  const valid = validUploads(files);
  if (valid.length === 0) {
    throw new AppError(
      "BAD_REQUEST",
      'Aucun .mid/.midi dans le champ "files"',
    );
  }
  const out: { name: string; xml: Buffer }[] = [];
  for (const f of valid) {
    const xml = await toXml(deps, f);
    out.push({ name: `${downloadBase(f.filename)}.musicxml`, xml });
  }
  return out;
}

// --- Publication
function requirePublisher(deps: Deps): void {
  if (!deps.settings.getCredentials()) {
    throw new AppError(
      "NOT_CONFIGURED",
      "Soundslice non configuré (réglages de l'interface ou variables SOUNDSLICE_APP_ID / SOUNDSLICE_PASSWORD)",
    );
  }
}

export async function publishOne(
  deps: Deps,
  file: UploadedFile,
  fields: { name?: string; artist?: string },
): Promise<{ scorehash: string; url: string; embedUrl?: string }> {
  requirePublisher(deps);
  const xml = await toXml(deps, file);
  return deps.publisher.publishMusicXml({
    name: displayTitle(xml, file.filename, fields.name),
    artist: (fields.artist ?? "").slice(0, 255) || undefined,
    xml,
  });
}

export interface BatchOptions {
  artist?: string;
  listId?: string;
  embedStatus?: number;
}

export interface BatchRecap {
  dryRun: boolean;
  listId?: string;
  results: PublishedFile[];
  failures: PublishFailure[];
  listError?: string;
}

export function previewBatch(
  files: UploadedFile[],
): { dryRun: true; items: { file: string; title: string }[] } {
  const valid = validUploads(files);
  if (valid.length === 0) {
    throw new AppError(
      "BAD_REQUEST",
      'Aucun .mid/.midi/.musicxml dans le champ "files"',
    );
  }
  return {
    dryRun: true,
    items: valid.map((u) => ({
      file: u.filename,
      title: displayTitle(isXmlFile(u.filename) ? u.buf : null, u.filename),
    })),
  };
}

export async function publishBatch(
  deps: Deps,
  files: UploadedFile[],
  opts: BatchOptions,
): Promise<BatchRecap> {
  requirePublisher(deps);
  if (
    opts.embedStatus !== undefined &&
    ![1, 2, 4].includes(opts.embedStatus)
  ) {
    throw new AppError("BAD_REQUEST", "embedStatus attendu : 1, 2 ou 4");
  }
  const valid = validUploads(files);
  if (valid.length === 0) {
    throw new AppError(
      "BAD_REQUEST",
      'Aucun .mid/.midi/.musicxml dans le champ "files"',
    );
  }
  const artist = (opts.artist ?? "").slice(0, 255) || undefined;
  const results: PublishedFile[] = [];
  const failures: PublishFailure[] = [];
  for (const u of valid) {
    try {
      const xml = await toXml(deps, u);
      const title = displayTitle(xml, u.filename);
      const pub = await deps.publisher.publishMusicXml({
        name: title,
        artist,
        embedStatus: opts.embedStatus,
        xml,
      });
      results.push({ file: u.filename, title, bytes: xml.length, ...pub });
    } catch (e) {
      failures.push({
        file: u.filename,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }
  const hashes = results.flatMap((r) => (r.scorehash ? [r.scorehash] : []));
  let listError: string | undefined;
  if (opts.listId && hashes.length > 0) {
    try {
      await deps.publisher.addToList(opts.listId, hashes);
    } catch (e) {
      listError = e instanceof Error ? e.message : String(e);
    }
  }
  return {
    dryRun: false,
    ...(opts.listId ? { listId: opts.listId } : {}),
    results,
    failures,
    ...(listError ? { listError } : {}),
  };
}

// --- Run de workflow (avec historique)
export async function runWorkflow(
  deps: Deps,
  workflowId: string,
  files: UploadedFile[],
  overrides: { dryRun?: boolean },
): Promise<RunRecord & { items?: { file: string; title: string }[] }> {
  const wf: Workflow | undefined = deps.workflows
    .workflows()
    .find((w) => w.id === workflowId);
  if (!wf) throw new AppError("NOT_FOUND", "Workflow introuvable");
  const valid = validUploads(files);
  if (valid.length === 0) {
    throw new AppError(
      "BAD_REQUEST",
      'Aucun .mid/.midi/.musicxml dans le champ "files"',
    );
  }
  const dryRun = overrides.dryRun ?? wf.dryRun;
  if (dryRun) {
    return deps.runs.push({
      workflowId: wf.id,
      workflowName: wf.name,
      dryRun: true,
      results: [],
      failures: [],
    }).then((record) => ({
      ...record,
      items: valid.map((u) => ({
        file: u.filename,
        title: displayTitle(isXmlFile(u.filename) ? u.buf : null, u.filename),
      })),
    }));
  }
  if (wf.publish) requirePublisher(deps);
  const results: PublishedFile[] = [];
  const failures: PublishFailure[] = [];
  for (const u of valid) {
    try {
      const xml = await toXml(deps, u);
      const title = displayTitle(xml, u.filename);
      if (!wf.publish) {
        results.push({ file: u.filename, title, bytes: xml.length });
        continue;
      }
      const pub = await deps.publisher.publishMusicXml({
        name: title,
        artist: wf.artist,
        embedStatus: wf.embedStatus,
        xml,
      });
      results.push({ file: u.filename, title, bytes: xml.length, ...pub });
    } catch (e) {
      failures.push({
        file: u.filename,
        reason: e instanceof Error ? e.message : String(e),
      });
    }
  }
  const hashes = results.flatMap((r) => (r.scorehash ? [r.scorehash] : []));
  let listError: string | undefined;
  if (wf.listId && hashes.length > 0) {
    try {
      await deps.publisher.addToList(wf.listId, hashes);
    } catch (e) {
      listError = e instanceof Error ? e.message : String(e);
    }
  }
  return deps.runs.push({
    workflowId: wf.id,
    workflowName: wf.name,
    dryRun: false,
    results,
    failures,
    ...(listError ? { listError } : {}),
  });
}
