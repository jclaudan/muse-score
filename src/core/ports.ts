// Ports (interfaces) : contrats que le cœur impose aux adaptateurs.
// Le cœur ne dépend que de ces abstractions (inversion de dépendances).
import type {
  PublishRef,
  PublishedFile,
  PublishFailure,
  RunRecord,
  Workflow,
  WorkflowInput,
} from "./model.js";

// Conversion MIDI -> MusicXML (ex : MuseScore CLI).
export interface ConverterPort {
  name(): string;
  // Binaire/service détecté, ou erreur explicite.
  status(): Promise<string>;
  convertMidi(input: Buffer, filename: string): Promise<Buffer>;
}

// Publication vers un hébergeur de partitions (ex : Soundslice).
export interface PublisherPort {
  name(): string;
  publishMusicXml(opts: {
    name: string;
    artist?: string;
    embedStatus?: number;
    xml: Buffer;
  }): Promise<PublishRef>;
  addToList(listId: string, scorehashes: string[]): Promise<void>;
  testConnection(): Promise<{ slices: number }>;
}

// Réglages (clé API + lien de don). L'env reste prioritaire (voir config).
export interface SettingsPort {
  getCredentials(): { id: string; pw: string } | null;
  credentialSource(): "env" | "store" | null;
  maskedAppId(): string;
  donateUrl(): string;
  save(appId: string, password: string, donateUrl?: string): Promise<void>;
  clear(): Promise<void>;
}

// Workflows CRUD.
export interface WorkflowRepository {
  workflows(): Workflow[];
  create(input: WorkflowInput): Promise<Workflow>;
  update(id: string, input: WorkflowInput): Promise<Workflow | null>;
  remove(id: string): Promise<boolean>;
}

// Historique des runs (borné).
export interface RunRepository {
  runs(): RunRecord[];
  push(run: Omit<RunRecord, "id" | "at">): Promise<RunRecord>;
}

export type { PublishedFile, PublishFailure };
