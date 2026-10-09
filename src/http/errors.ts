// Traduction erreurs métier -> HTTP (seul endroit qui connaît les statuts).
import { AppError, type ErrorCode } from "../core/errors.js";

const STATUS: Record<ErrorCode, number> = {
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  NOT_CONFIGURED: 503,
  CONVERSION_FAILED: 500,
  PUBLISH_FAILED: 500,
  UPSTREAM_ERROR: 500,
};

const LABEL: Partial<Record<ErrorCode, string>> = {
  CONVERSION_FAILED: "Échec conversion MuseScore",
  PUBLISH_FAILED: "Échec publication Soundslice",
};

export function toHttp(e: unknown): {
  status: number;
  body: { error: string; details?: string };
} {
  if (e instanceof AppError) {
    const label = LABEL[e.code];
    return {
      status: STATUS[e.code],
      body: label ? { error: label, details: e.message } : { error: e.message },
    };
  }
  return { status: 500, body: { error: "Erreur interne" } };
}
