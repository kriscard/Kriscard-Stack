export type ArtifactStoreErrorCode =
  | "INVALID_PATH"
  | "SYMLINK_ESCAPE"
  | "INVALID_ARTIFACT"
  | "HASH_MISMATCH"
  | "IMMUTABLE_CONFLICT"
  | "MIGRATION_CONFLICT";

export class ArtifactStoreError extends Error {
  constructor(
    readonly code: ArtifactStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ArtifactStoreError";
  }
}
