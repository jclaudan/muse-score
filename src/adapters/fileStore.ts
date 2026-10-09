// Adaptateur persistance : un fichier JSON local (jamais commité).
// Implémente les trois ports de stockage d'un coup (façade Repository).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { AppError } from "../core/errors.js";
import type {
  RunRepository,
  SettingsPort,
  WorkflowRepository,
} from "../core/ports.js";
import type {
  RunRecord,
  Workflow,
  WorkflowInput,
} from "../core/model.js";

interface StoreData {
  settings: { appId: string; password: string; donateUrl: string };
  workflows: Workflow[];
  runs: RunRecord[];
}

const MAX_RUNS = 10;

function blank(): StoreData {
  return {
    settings: { appId: "", password: "", donateUrl: "" },
    workflows: [],
    runs: [],
  };
}

function mask(id: string): string {
  if (id.length <= 3) return "***";
  return `${id.slice(0, 3)}••••••`;
}

function validateUrl(u: string): string {
  const v = u.trim();
  if (v && !/^https?:\/\//i.test(v)) {
    throw new AppError(
      "BAD_REQUEST",
      "Lien de don invalide (doit commencer par http(s)://)",
    );
  }
  return v.slice(0, 500);
}

function cleanWorkflowInput(
  input: WorkflowInput,
): Omit<Workflow, "id" | "createdAt" | "updatedAt"> {
  const name = String(input?.name ?? "").trim().slice(0, 100);
  if (!name) throw new AppError("BAD_REQUEST", 'Champ "name" requis');
  const artist = String(input?.artist ?? "").trim().slice(0, 255) || undefined;
  const listId = String(input?.listId ?? "").trim() || undefined;
  let embedStatus: 1 | 2 | 4 | undefined;
  if (input?.embedStatus !== undefined && input?.embedStatus !== "") {
    const n = Number(input.embedStatus);
    if (![1, 2, 4].includes(n)) {
      throw new AppError("BAD_REQUEST", "embedStatus attendu : 1, 2 ou 4");
    }
    embedStatus = n as 1 | 2 | 4;
  }
  return {
    name,
    artist,
    listId,
    embedStatus,
    publish: input?.publish !== false,
    dryRun: input?.dryRun === true,
  };
}

export class JsonFileStore
  implements SettingsPort, WorkflowRepository, RunRepository
{
  private cache: StoreData | null = null;

  constructor(private readonly file: string) {}

  static async open(dir: string): Promise<JsonFileStore> {
    const store = new JsonFileStore(join(dir, "store.json"));
    await store.load();
    return store;
  }

  private async load(): Promise<void> {
    if (!existsSync(this.file)) {
      this.cache = blank();
      return;
    }
    try {
      const parsed = JSON.parse(
        await readFile(this.file, "utf-8"),
      ) as Partial<StoreData>;
      this.cache = {
        settings: {
          appId: parsed.settings?.appId ?? "",
          password: parsed.settings?.password ?? "",
          donateUrl: parsed.settings?.donateUrl ?? "",
        },
        workflows: Array.isArray(parsed.workflows) ? parsed.workflows : [],
        runs: Array.isArray(parsed.runs) ? parsed.runs : [],
      };
    } catch {
      this.cache = blank();
    }
  }

  private data(): StoreData {
    if (!this.cache) throw new AppError("UPSTREAM_ERROR", "Store non chargé");
    return this.cache;
  }

  private async persist(): Promise<void> {
    if (!this.cache) return;
    await mkdir(join(this.file, ".."), { recursive: true });
    await writeFile(this.file, JSON.stringify(this.cache, null, 2), {
      mode: 0o600,
    });
  }

  // --- SettingsPort
  getCredentials(): { id: string; pw: string } | null {
    const envId = process.env.SOUNDSLICE_APP_ID;
    const envPw = process.env.SOUNDSLICE_PASSWORD;
    if (envId && envPw) return { id: envId, pw: envPw };
    const s = this.cache?.settings;
    if (s?.appId && s?.password) return { id: s.appId, pw: s.password };
    return null;
  }

  credentialSource(): "env" | "store" | null {
    if (process.env.SOUNDSLICE_APP_ID && process.env.SOUNDSLICE_PASSWORD)
      return "env";
    const s = this.cache?.settings;
    return s?.appId && s?.password ? "store" : null;
  }

  maskedAppId(): string {
    const src = this.credentialSource();
    if (!src) return "";
    const id =
      src === "env"
        ? (process.env.SOUNDSLICE_APP_ID as string)
        : (this.cache?.settings.appId ?? "");
    return mask(id);
  }

  donateUrl(): string {
    const env = (process.env.DONATE_URL ?? "").trim();
    if (env) return env;
    return this.cache?.settings.donateUrl ?? "";
  }

  async save(
    appId: string,
    password: string,
    donateUrl?: string,
  ): Promise<void> {
    const s = this.data();
    s.settings = {
      appId: appId.trim(),
      password,
      donateUrl:
        donateUrl !== undefined
          ? validateUrl(donateUrl)
          : (s.settings.donateUrl ?? ""),
    };
    await this.persist();
  }

  async clear(): Promise<void> {
    const s = this.data();
    s.settings = { appId: "", password: "", donateUrl: s.settings.donateUrl ?? "" };
    await this.persist();
  }

  // --- WorkflowRepository
  workflows(): Workflow[] {
    return this.data().workflows;
  }

  async create(input: WorkflowInput): Promise<Workflow> {
    const s = this.data();
    const now = new Date().toISOString();
    const wf: Workflow = {
      ...cleanWorkflowInput(input),
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    s.workflows.push(wf);
    await this.persist();
    return wf;
  }

  async update(id: string, input: WorkflowInput): Promise<Workflow | null> {
    const s = this.data();
    const wf = s.workflows.find((w) => w.id === id);
    if (!wf) return null;
    Object.assign(wf, cleanWorkflowInput({ ...wf, ...input }), {
      id: wf.id,
      createdAt: wf.createdAt,
      updatedAt: new Date().toISOString(),
    });
    await this.persist();
    return wf;
  }

  async remove(id: string): Promise<boolean> {
    const s = this.data();
    const i = s.workflows.findIndex((w) => w.id === id);
    if (i < 0) return false;
    s.workflows.splice(i, 1);
    await this.persist();
    return true;
  }

  // --- RunRepository
  runs(): RunRecord[] {
    return this.data().runs;
  }

  async push(run: Omit<RunRecord, "id" | "at">): Promise<RunRecord> {
    const s = this.data();
    const record: RunRecord = {
      ...run,
      id: randomUUID(),
      at: new Date().toISOString(),
    };
    s.runs.unshift(record);
    s.runs = s.runs.slice(0, MAX_RUNS);
    await this.persist();
    return record;
  }
}
