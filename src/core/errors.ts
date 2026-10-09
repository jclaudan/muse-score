// Erreurs métier typées : le cœur ne connaît pas HTTP.
// La couche HTTP les convertit en statuts (voir http/errors.ts).
export type ErrorCode =
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "NOT_CONFIGURED"
  | "CONVERSION_FAILED"
  | "PUBLISH_FAILED"
  | "UPSTREAM_ERROR";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details?: string;

  constructor(code: ErrorCode, message: string, details?: string) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }
}
