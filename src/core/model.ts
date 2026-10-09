// Modèle du domaine : aucune dépendance technique.
export interface PublishRef {
  scorehash: string;
  url: string;
  embedUrl?: string;
}

export interface PublishedFile {
  file: string;
  title: string;
  bytes?: number;
  scorehash?: string;
  url?: string;
  embedUrl?: string;
}

export interface PublishFailure {
  file: string;
  reason: string;
}

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

export interface WorkflowInput {
  name?: unknown;
  artist?: unknown;
  listId?: unknown;
  embedStatus?: unknown;
  publish?: unknown;
  dryRun?: unknown;
}

export interface RunRecord {
  id: string;
  workflowId: string;
  workflowName: string;
  at: string;
  dryRun: boolean;
  results: PublishedFile[];
  failures: PublishFailure[];
  listError?: string;
}

export interface UploadedFile {
  filename: string;
  buf: Buffer;
}
