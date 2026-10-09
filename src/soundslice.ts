// Client minimal de la Soundslice Data API.
// Docs : https://www.soundslice.com/help/data-api/
// Prerequis : compte payant (Teacher/Licensing) + permission speciale
// "Upload a slice's notation" (a demander a Soundslice, sinon 403).
import { Buffer } from "node:buffer";

const API = "https://www.soundslice.com/api/v1";

export function soundsliceConfigured(): boolean {
  return !!(
    process.env.SOUNDSLICE_APP_ID && process.env.SOUNDSLICE_PASSWORD
  );
}

function auth(): string {
  const id = process.env.SOUNDSLICE_APP_ID;
  const pw = process.env.SOUNDSLICE_PASSWORD;
  if (!id || !pw) {
    throw new Error(
      "Soundslice non configuré (SOUNDSLICE_APP_ID / SOUNDSLICE_PASSWORD manquants)",
    );
  }
  return `Basic ${Buffer.from(`${id}:${pw}`).toString("base64")}`;
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

export async function createSlice(opts: {
  name: string;
  artist?: string;
}): Promise<{ scorehash: string; slug: string; url: string }> {
  const form = new URLSearchParams({ name: opts.name.slice(0, 255) });
  if (opts.artist) form.set("artist", opts.artist.slice(0, 255));
  const { status, json } = await api("/slices/", { method: "POST", form });
  if (status !== 201 || !json?.scorehash) {
    throwFor(status, json, "création du slice");
  }
  return { scorehash: json.scorehash, slug: json.slug, url: json.url };
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

export async function publishMusicXml(opts: {
  name: string;
  artist?: string;
  xml: Buffer;
}): Promise<{ scorehash: string; url: string }> {
  if (opts.xml.length === 0) throw new Error("MusicXML vide");
  const slice = await createSlice({ name: opts.name, artist: opts.artist });
  const putUrl = await initiateNotationUpload(slice.scorehash);
  await putNotation(putUrl, opts.xml);
  await waitNotation(slice.scorehash);
  const { json } = await api(`/slices/${encodeURIComponent(slice.scorehash)}/`);
  return { scorehash: slice.scorehash, url: json?.url ?? slice.url };
}
