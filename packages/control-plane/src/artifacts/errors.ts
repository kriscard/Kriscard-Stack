export type ArtifactStoreErrorCode =
  | "INVALID_PATH"
  | "SYMLINK_ESCAPE"
  | "INVALID_ARTIFACT"
  | "HASH_MISMATCH"
  | "IMMUTABLE_CONFLICT"
  | "MIGRATION_CONFLICT";

export type ArtifactStoreError = Error & {
  readonly code: ArtifactStoreErrorCode;
};

const errorCodes = new Set<string>([
  "INVALID_PATH",
  "SYMLINK_ESCAPE",
  "INVALID_ARTIFACT",
  "HASH_MISMATCH",
  "IMMUTABLE_CONFLICT",
  "MIGRATION_CONFLICT",
]);

export function artifactStoreError(
  code: ArtifactStoreErrorCode,
  message: string,
): ArtifactStoreError {
  return Object.assign(new Error(message), {
    name: "ArtifactStoreError",
    code,
  });
}

export function isArtifactStoreError(
  error: unknown,
): error is ArtifactStoreError {
  return (
    error instanceof Error &&
    error.name === "ArtifactStoreError" &&
    "code" in error &&
    typeof error.code === "string" &&
    errorCodes.has(error.code)
  );
}
