import {
  EvidenceVerdictSchema,
  GitShaSchema,
  RevisionIdSchema,
  TimestampSchema,
  VerdictIdSchema,
  WorkItemIdSchema,
} from "@kriscard/core";
import * as z from "zod";

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

export const ArtifactContextSchema = z.looseObject({
  repositoryFingerprint: z.string().min(1),
  targetBranch: z.string().min(1),
  startingCommit: GitShaSchema,
  workItemId: WorkItemIdSchema,
  taskGroup: z.string().min(1),
  branch: z.string().min(1).optional(),
  pullRequest: z.int().positive().optional(),
});
export type ArtifactContext = z.output<typeof ArtifactContextSchema>;

export const StoredFileSchema = z.looseObject({
  path: z.string().min(1),
  sha256: Sha256Schema,
  size: z.int().nonnegative(),
});
export type StoredFile = z.output<typeof StoredFileSchema>;

const ManifestBase = {
  schemaVersion: z.literal(1),
  context: ArtifactContextSchema,
  createdAt: TimestampSchema,
  files: z.array(StoredFileSchema).min(1),
};

export const RevisionBundleManifestSchema = z.looseObject({
  ...ManifestBase,
  kind: z.literal("revision"),
  revisionId: RevisionIdSchema,
  approvedHashes: z.looseObject({
    spec: Sha256Schema,
    plan: Sha256Schema,
    approval: Sha256Schema,
  }),
});
export type RevisionBundleManifest = z.output<
  typeof RevisionBundleManifestSchema
>;

export const EvidenceBundleManifestSchema = z.looseObject({
  ...ManifestBase,
  kind: z.literal("evidence"),
  verdictId: VerdictIdSchema,
  verdict: EvidenceVerdictSchema,
});
export type EvidenceBundleManifest = z.output<
  typeof EvidenceBundleManifestSchema
>;

export const ArtifactBundleManifestSchema = z.discriminatedUnion("kind", [
  RevisionBundleManifestSchema,
  EvidenceBundleManifestSchema,
]);
export type ArtifactBundleManifest = z.output<
  typeof ArtifactBundleManifestSchema
>;

export const MigrationSourceSchema = z.looseObject({
  sourcePath: z.string().min(1),
  storedPath: z.string().min(1),
});
export type MigrationSource = z.output<typeof MigrationSourceSchema>;

export const MigrationJournalSchema = z.looseObject({
  schemaVersion: z.literal(1),
  migrationId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,127}$/),
  status: z.enum(["copying", "committed"]),
  sourceDirectory: z.string().min(1),
  destinationRelative: z.string().min(1),
  manifest: ArtifactBundleManifestSchema,
  sources: z.array(MigrationSourceSchema).min(1),
  completedFiles: z.array(z.string().min(1)),
  updatedAt: TimestampSchema,
});
export type MigrationJournal = z.output<typeof MigrationJournalSchema>;
