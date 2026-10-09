// Client minimal de la Soundslice Data API.
// Docs : https://www.soundslice.com/help/data-api/
// Prerequis : compte payant (Teacher/Licensing) + permission speciale
// "Upload a slice's notation" (a demander a Soundslice, sinon 403).
import { Buffer } from "node:buffer";
import { getCredentials } from "./store.js";

const API = "https://www.soundslice.com/api/v1";

export function soundsliceConfigured(): boolean {
  return getCredentials() !== null;
}

function auth(): string {
  const c = getCredentials();
  if (!c) {
    throw new Error(
      "Soundslice non configuré (réglages de l'interface ou variables SOUNDSLICE_APP_ID / SOUNDSLICE_PASSWORD)",
    );
  }
  return `Basic ${Buffer.from(`${c.id}:${c.pw}`).toString("base64")}`;
}

async function api(
  path: string,
  opts: { method?: string; form?: URLSearchParams } = {},
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${API}${path}`, {
    method: opts.method ?? "GET",
    headers: {
      Authorization: auth(),
      ...(opts.form
        ? { "Content-Type": "application/x-www-form-urlencoded" }
        : {}),
    },
    body: opts.form ? opts.form.toString() : undefined,
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    // reponse non-JSON (rare) : on garde null
  }
  return { status: res.status, json };
}

function throwFor(status: number, json: any, action: string): never {
  if (status === 403) {
    throw new Error(
      `Soundslice 403 sur ${action} : clé invalide, ou permission spéciale ` +
        `"Upload a slice's notation" non activée (à demander à Soundslice).`,
    );
  }
  const details =
    json?.errors ??
    json?.error ??
    (typeof json === "string" ? json : JSON.stringify(json)) ??
    "sans détail";
  throw new Error(`Soundslice ${status} sur ${action} : ${details}`);
}

// Titre lu dans le fichier (<work-title>), comme le script Python.
// Retourne null si absent.
export function titleFromMusicXml(xml: Buffer): string | null {
  const m = xml
    .toString("utf-8", 0, Math.min(xml.length, 200_000))
    .match(/<work-title>([\s\S]*?)<\/work-title>/);
  if (!m) return null;
  const title = m[1].replace(/<[^>]*>/g, "").trim();
  return title ? title.slice(0, 255) : null;
}

export interface SliceOptions {
  name: string;
  artist?: string;
  /** 1 = URL secrète désactivée (défaut), 3 = activée */
  status?: number;
  /** 1 = désactivé (défaut), 2 = tous domaines, 4 = domaines autorisés */
  embedStatus?: number;
  /** 1 = impression désactivée (défaut), 3 = autorisée */
  printStatus?: number;
}

export async function createSlice(opts: SliceOptions): Promise<{
  scorehash: string;
  slug: string;
  url: string;
  embedUrl?: string;
}> {
  const form = new URLSearchParams({ name: opts.name.slice(0, 255) });
  if (opts.artist) form.set("artist", opts.artist.slice(0, 255));
  if (opts.status) form.set("status", String(opts.status));
  if (opts.embedStatus) form.set("embed_status", String(opts.embedStatus));
  if (opts.printStatus) form.set("print_status", String(opts.printStatus));
  const { status, json } = await api("/slices/", { method: "POST", form });
  if (status !== 201 || !json?.scorehash) {
    throwFor(status, json, "création du slice");
  }
  return {
    scorehash: json.scorehash,
    slug: json.slug,
    url: json.url,
    embedUrl: json.embed_url,
  };
}

async function initiateNotationUpload(scorehash: string): Promise<string> {
  const { status, json } = await api(
    `/slices/${encodeURIComponent(scorehash)}/notation-file/`,
    { method: "POST" },
  );
  if (status !== 200 || !json?.url) {
    throwFor(status, json, "initiation de l'upload");
  }
  return json.url as string;
}

async function putNotation(putUrl: string, xml: Buffer): Promise<void> {
  // Important : PAS d'authentification et PAS de Content-Type sur ce PUT.
  const res = await fetch(putUrl, { method: "PUT", body: new Uint8Array(xml) });
  if (!res.ok) {
    throw new Error(`Soundslice PUT notation : HTTP ${res.status}`);
  }
}

async function waitNotation(
  scorehash: string,
  timeoutMs = 180_000,
): Promise<void> {
  const t0 = Date.now();
  for (;;) {
    const { status, json } = await api(
      `/slices/${encodeURIComponent(scorehash)}/`,
    );
    if (status === 200 || status === 201) {
      if (json?.has_notation) return;
    } else if (status === 403) {
      throwFor(status, json, "attente du traitement");
    }
    if (Date.now() - t0 > timeoutMs) {
      throw new Error(
        "Soundslice : traitement trop long (slice créé, notation en cours ?)",
      );
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
}

export async function publishMusicXml(
  opts: SliceOptions & { xml: Buffer },
): Promise<{ scorehash: string; url: string; embedUrl?: string }> {
  if (opts.xml.length === 0) throw new Error("MusicXML vide");
  const slice = await createSlice(opts);
  const putUrl = await initiateNotationUpload(slice.scorehash);
  await putNotation(putUrl, opts.xml);
  await waitNotation(slice.scorehash);
  const { json } = await api(`/slices/${encodeURIComponent(slice.scorehash)}/`);
  return {
    scorehash: slice.scorehash,
    url: json?.url ?? slice.url,
    embedUrl: json?.embed_url ?? slice.embedUrl,
  };
}

// Teste la clé : liste les slices du compte.
export async function testConnection(): Promise<{ slices: number }> {
  const { status, json } = await api("/slices/");
  if (status !== 200 || !Array.isArray(json)) {
    throwFor(status, json, "test de connexion");
  }
  return { slices: (json as unknown[]).length };
}

// Range les slices dans une liste du compte (les "dossiers" n'existent plus,
// remplacés par les listes).
export async function addSlicesToList(
  listId: string,
  scorehashes: string[],
): Promise<void> {
  if (scorehashes.length === 0) return;
  const form = new URLSearchParams({
    slicehashes: scorehashes.join(","),
  });
  const { status, json } = await api(
    `/lists/${encodeURIComponent(listId)}/slices/`,
    { method: "POST", form },
  );
  if (status !== 201) {
    throwFor(status, json, `ajout à la liste ${listId}`);
  }
}
