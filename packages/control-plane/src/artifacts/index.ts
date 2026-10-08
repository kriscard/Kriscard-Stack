export { artifactStoreError, isArtifactStoreError } from "./errors.js";
export type { ArtifactStoreError, ArtifactStoreErrorCode } from "./errors.js";

export {
  ArtifactBundleManifestSchema,
  ArtifactContextSchema,
  EvidenceArtifactContextSchema,
  EvidenceBundleManifestSchema,
  MigrationJournalSchema,
  MigrationSourceSchema,
  RevisionBundleManifestSchema,
  StoredFileSchema,
} from "./schemas.js";
export type {
  ArtifactBundleManifest,
  ArtifactContext,
  EvidenceArtifactContext,
  EvidenceBundleManifest,
  MigrationJournal,
  MigrationSource,
  RevisionBundleManifest,
  StoredFile,
} from "./schemas.js";

export { createArtifactStore } from "./store.js";
export type {
  ArtifactReference,
  ArtifactStoreOptions,
  EvidenceImportRequest,
  MigrationCheckpoint,
  MigrationPhase,
  RevisionImportRequest,
  StoredBundle,
} from "./store.js";
