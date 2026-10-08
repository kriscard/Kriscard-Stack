export type CoreErrorCode =
  | "INVALID_RECORD"
  | "INVALID_TRANSITION"
  | "UNAUTHORIZED_TRANSITION"
  | "INVALID_BUDGET";

export class CoreInvariantError extends Error {
  constructor(
    readonly code: CoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CoreInvariantError";
  }
}
