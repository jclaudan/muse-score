// Adaptateur PublisherPort : Soundslice Data API.
// Docs : https://www.soundslice.com/help/data-api/
import { Buffer } from "node:buffer";
import { AppError } from "../core/errors.js";
import type {
  PublisherPort,
  SettingsPort,
} from "../core/ports.js";
import type { PublishRef } from "../core/model.js";

const API = "https://www.soundslice.com/api/v1";

export class SoundslicePublisher implements PublisherPort {
  constructor(private readonly settings: SettingsPort) {}

  name(): string {
    return "Soundslice";
  }

  private auth(): string {
    const c = this.settings.getCredentials();
    if (!c) {
      throw new AppError(
        "NOT_CONFIGURED",
        "Soundslice non configuré (réglages de l'interface ou variables SOUNDSLICE_APP_ID / SOUNDSLICE_PASSWORD)",
      );
    }
    return `Basic ${Buffer.from(`${c.id}:${c.pw}`).toString("base64")}`;
  }

  private async api(
    path: string,
    opts: { method?: string; form?: URLSearchParams } = {},
  ): Promise<{ status: number; json: any }> {
    const res = await fetch(`${API}${path}`, {
      method: opts.method ?? "GET",
      headers: {
        Authorization: this.auth(),
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
      // réponse non-JSON : on garde null
    }
    return { status: res.status, json };
  }

  private fail(status: number, json: any, action: string): never {
    if (status === 403) {
      throw new AppError(
        "PUBLISH_FAILED",
        `Soundslice 403 sur ${action} : clé invalide, ou permission spéciale ` +
          `"Upload a slice's notation" non activée (à demander à Soundslice).`,
      );
    }
    const details =
      json?.errors ??
      json?.error ??
      (typeof json === "string" ? json : JSON.stringify(json)) ??
      "sans détail";
    throw new AppError("PUBLISH_FAILED", `Soundslice ${status} sur ${action} : ${details}`);
  }

  private async createSlice(opts: {
    name: string;
    artist?: string;
    embedStatus?: number;
  }): Promise<PublishRef & { slug: string }> {
    const form = new URLSearchParams({ name: opts.name.slice(0, 255) });
    if (opts.artist) form.set("artist", opts.artist.slice(0, 255));
    if (opts.embedStatus) form.set("embed_status", String(opts.embedStatus));
    const { status, json } = await this.api("/slices/", {
      method: "POST",
      form,
    });
    if (status !== 201 || !json?.scorehash) {
      this.fail(status, json, "création du slice");
    }
    return {
      scorehash: json.scorehash,
      slug: json.slug,
      url: json.url,
      embedUrl: json.embed_url,
    };
  }

  private async initiateNotationUpload(scorehash: string): Promise<string> {
    const { status, json } = await this.api(
      `/slices/${encodeURIComponent(scorehash)}/notation-file/`,
      { method: "POST" },
    );
    if (status !== 200 || !json?.url) {
      this.fail(status, json, "initiation de l'upload");
    }
    return json.url as string;
  }

  private async putNotation(putUrl: string, xml: Buffer): Promise<void> {
    // Important : PAS d'authentification et PAS de Content-Type sur ce PUT.
    const res = await fetch(putUrl, {
      method: "PUT",
      body: new Uint8Array(xml),
    });
    if (!res.ok) {
      throw new AppError(
        "PUBLISH_FAILED",
        `Soundslice PUT notation : HTTP ${res.status}`,
      );
    }
  }

  private async waitNotation(
    scorehash: string,
    timeoutMs = 180_000,
  ): Promise<void> {
    const t0 = Date.now();
    for (;;) {
      const { status, json } = await this.api(
        `/slices/${encodeURIComponent(scorehash)}/`,
      );
      if (status === 200 || status === 201) {
        if (json?.has_notation) return;
      } else if (status === 403) {
        this.fail(status, json, "attente du traitement");
      }
      if (Date.now() - t0 > timeoutMs) {
        throw new AppError(
          "PUBLISH_FAILED",
          "Soundslice : traitement trop long (slice créé, notation en cours ?)",
        );
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  async publishMusicXml(opts: {
    name: string;
    artist?: string;
    embedStatus?: number;
    xml: Buffer;
  }): Promise<PublishRef> {
    if (opts.xml.length === 0) {
      throw new AppError("BAD_REQUEST", "MusicXML vide");
    }
    const slice = await this.createSlice(opts);
    const putUrl = await this.initiateNotationUpload(slice.scorehash);
    await this.putNotation(putUrl, opts.xml);
    await this.waitNotation(slice.scorehash);
    const { json } = await this.api(
      `/slices/${encodeURIComponent(slice.scorehash)}/`,
    );
    return {
      scorehash: slice.scorehash,
      url: json?.url ?? slice.url,
      embedUrl: json?.embed_url ?? slice.embedUrl,
    };
  }

  async addToList(listId: string, scorehashes: string[]): Promise<void> {
    if (scorehashes.length === 0) return;
    const form = new URLSearchParams({
      slicehashes: scorehashes.join(","),
    });
    const { status, json } = await this.api(
      `/lists/${encodeURIComponent(listId)}/slices/`,
      { method: "POST", form },
    );
    if (status !== 201) {
      this.fail(status, json, `ajout à la liste ${listId}`);
    }
  }

  async testConnection(): Promise<{ slices: number }> {
    const { status, json } = await this.api("/slices/");
    if (status !== 200 || !Array.isArray(json)) {
      this.fail(status, json, "test de connexion");
    }
    return { slices: (json as unknown[]).length };
  }
}
