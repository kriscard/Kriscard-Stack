export type CoreErrorCode =
  | "INVALID_RECORD"
  | "INVALID_TRANSITION"
  | "UNAUTHORIZED_TRANSITION"
  | "INVALID_BUDGET";

/** Identifies a rejected domain operation without exposing untrusted input data. */
export class CoreInvariantError extends Error {
  constructor(
    readonly code: CoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CoreInvariantError";
  }
}
