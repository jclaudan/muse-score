// Persistance locale (jamais commité : DATA_DIR ignoré par git).
// Contient les réglages Soundslice, les workflows et l'historique des runs.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export interface Workflow {
  id: string;
  name: string;
  artist?: string;
  listId?: string;
  embedStatus?: 1 | 2 | 4;
  publish: boolean;
  dryRun: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RunRecord {
  id: string;
  workflowId: string;
  workflowName: string;
  at: string;
  dryRun: boolean;
  results: {
    file: string;
    title: string;
    bytes?: number;
    scorehash?: string;
    url?: string;
    embedUrl?: string;
  }[];
  failures: { file: string; reason: string }[];
  listError?: string;
}

interface StoreData {
  settings: { appId: string; password: string };
  workflows: Workflow[];
  runs: RunRecord[];
}

const DIR = process.env.DATA_DIR ?? join(process.cwd(), "data");
const FILE = join(DIR, "store.json");
const MAX_RUNS = 10;

let cache: StoreData | null = null;

function blank(): StoreData {
  return { settings: { appId: "", password: "" }, workflows: [], runs: [] };
}

export async function loadStore(): Promise<StoreData> {
  if (cache) return cache;
  if (!existsSync(FILE)) {
    cache = blank();
    return cache;
  }
  try {
    const raw = await readFile(FILE, "utf-8");
    const parsed = JSON.parse(raw) as Partial<StoreData>;
    cache = {
      settings: {
        appId: parsed.settings?.appId ?? "",
        password: parsed.settings?.password ?? "",
      },
      workflows: Array.isArray(parsed.workflows) ? parsed.workflows : [],
      runs: Array.isArray(parsed.runs) ? parsed.runs : [],
    };
  } catch {
    cache = blank();
  }
  return cache;
}

export async function saveStore(): Promise<void> {
  if (!cache) return;
  await mkdir(DIR, { recursive: true });
  await writeFile(FILE, JSON.stringify(cache, null, 2), { mode: 0o600 });
}

function store(): StoreData {
  if (!cache) throw new Error("Store non chargé");
  return cache;
}

// --- Réglages (la clé API peut aussi venir de l'environnement, prioritaire)
export function getCredentials(): { id: string; pw: string } | null {
  const envId = process.env.SOUNDSLICE_APP_ID;
  const envPw = process.env.SOUNDSLICE_PASSWORD;
  if (envId && envPw) return { id: envId, pw: envPw };
  const s = cache?.settings;
  if (s?.appId && s?.password) return { id: s.appId, pw: s.password };
  return null;
}

export function credentialSource(): "env" | "store" | null {
  if (process.env.SOUNDSLICE_APP_ID && process.env.SOUNDSLICE_PASSWORD)
    return "env";
  const s = cache?.settings;
  return s?.appId && s?.password ? "store" : null;
}

function mask(id: string): string {
  if (id.length <= 3) return "***";
  return `${id.slice(0, 3)}••••••`;
}

export function maskedSettings(): {
  configured: boolean;
  source: "env" | "store" | null;
  appId: string;
} {
  const src = credentialSource();
  const id =
    src === "env"
      ? (process.env.SOUNDSLICE_APP_ID as string)
      : (cache?.settings.appId ?? "");
  return { configured: src !== null, source: src, appId: src ? mask(id) : "" };
}

export async function setCredentials(
  appId: string,
  password: string,
): Promise<void> {
  const s = store();
  s.settings = { appId: appId.trim(), password };
  await saveStore();
}

export async function clearCredentials(): Promise<void> {
  const s = store();
  s.settings = { appId: "", password: "" };
  await saveStore();
}

// --- Workflows
export function listWorkflows(): Workflow[] {
  return store().workflows;
}

function cleanWorkflowInput(input: any): Omit<Workflow, "id" | "createdAt" | "updatedAt"> {
  const name = String(input?.name ?? "").trim().slice(0, 100);
  if (!name) throw new Error('Champ "name" requis');
  const artist = String(input?.artist ?? "").trim().slice(0, 255) || undefined;
  const listId = String(input?.listId ?? "").trim() || undefined;
  let embedStatus: 1 | 2 | 4 | undefined;
  if (input?.embedStatus !== undefined && input?.embedStatus !== "") {
    const n = Number(input.embedStatus);
    if (![1, 2, 4].includes(n)) throw new Error("embedStatus attendu : 1, 2 ou 4");
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

export async function createWorkflow(input: any): Promise<Workflow> {
  const s = store();
  const now = new Date().toISOString();
  const wf: Workflow = {
    ...cleanWorkflowInput(input),
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
  };
  s.workflows.push(wf);
  await saveStore();
  return wf;
}

export async function updateWorkflow(
  id: string,
  input: any,
): Promise<Workflow | null> {
  const s = store();
  const wf = s.workflows.find((w) => w.id === id);
  if (!wf) return null;
  Object.assign(wf, cleanWorkflowInput({ ...wf, ...input }), {
    id: wf.id,
    createdAt: wf.createdAt,
    updatedAt: new Date().toISOString(),
  });
  await saveStore();
  return wf;
}

export async function deleteWorkflow(id: string): Promise<boolean> {
  const s = store();
  const i = s.workflows.findIndex((w) => w.id === id);
  if (i < 0) return false;
  s.workflows.splice(i, 1);
  await saveStore();
  return true;
}

// --- Historique des runs
export function listRuns(): RunRecord[] {
  return store().runs;
}

export async function pushRun(
  run: Omit<RunRecord, "id" | "at">,
): Promise<RunRecord> {
  const s = store();
  const record: RunRecord = {
    ...run,
    id: randomUUID(),
    at: new Date().toISOString(),
  };
  s.runs.unshift(record);
  s.runs = s.runs.slice(0, MAX_RUNS);
  await saveStore();
  return record;
}
