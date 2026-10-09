import { lstat, readdir, rm } from "node:fs/promises";
import path from "node:path";

import {
  EvidenceVerdictSchema,
  RevisionIdSchema,
  VerdictIdSchema,
  WorkItemIdSchema,
  type EvidenceVerdict,
  type RevisionId,
  type VerdictId,
  type WorkItemId,
} from "@kriscard/core";

import { parseApprovedHashes } from "./approval.js";
import { artifactStoreError } from "./errors.js";
import {
  createMigrationOperations,
  type MigrationCheckpoint,
  type PreparedBundle,
  type StoredBundle,
} from "./migration.js";
import {
  hashFile,
  readParsedJson,
  sha256,
  syncDirectory,
  writePrivateFileAtomic,
  writePrivateJson,
} from "./files.js";
import {
  assertSafeSourceFile,
  canonicalizePotentialPath,
  defaultArtifactRoot,
  ensurePrivateDirectory,
  portablePathKey,
  readFileWithoutFollowingSymlinks,
  resolveWithin,
} from "./paths.js";
import {
  ArtifactBundleManifestSchema,
  ArtifactContextSchema,
  EvidenceArtifactContextSchema,
  type ArtifactBundleManifest,
  type ArtifactContext,
  type EvidenceArtifactContext,
  type EvidenceBundleManifest,
  type MigrationSource,
  type RevisionBundleManifest,
  type StoredFile,
} from "./schemas.js";
import {
  assertExpectedHash,
  ensurePrivateDirectoryForFile,
  pathExists,
} from "./storage-helpers.js";

export type {
  MigrationPhase,
  MigrationCheckpoint,
  StoredBundle,
} from "./migration.js";

export interface ArtifactStoreOptions {
  root?: string;
  onCheckpoint?: (checkpoint: MigrationCheckpoint) => void | Promise<void>;
}

interface ImportOptions {
  migrationId?: string;
  createdAt?: string;
}

export interface RevisionImportRequest extends ImportOptions {
  context: ArtifactContext;
  revisionId: RevisionId;
  sourceDirectory: string;
  supportingFiles?: readonly string[];
  /** Optional lifecycle receipts that must still match the canonical files at import time. */
  expectedHashes?: { spec: string; plan: string };
}

export interface EvidenceImportRequest extends ImportOptions {
  context: EvidenceArtifactContext;
  verdict: EvidenceVerdict;
  sourceDirectory: string;
  files: readonly string[];
}

export type ArtifactReference =
  | {
      kind: "revision";
      repositoryFingerprint: string;
      workItemId: WorkItemId;
      revisionId: RevisionId;
    }
  | {
      kind: "evidence";
      repositoryFingerprint: string;
      workItemId: WorkItemId;
      verdictId: VerdictId;
    };

/** Creates a private store for immutable approved revisions and evidence. */
export function createArtifactStore(options: ArtifactStoreOptions = {}) {
  const root = canonicalizePotentialPath(options.root ?? defaultArtifactRoot());
  const migrations = createMigrationOperations({
    root,
    verifyBundleAt,
    assertExternalSourceDirectory,
    onCheckpoint: options.onCheckpoint,
  });

  async function initialize(): Promise<void> {
    await ensurePrivateDirectory(root);
    await ensurePrivateDirectory(root, ".migrations");
    await ensurePrivateDirectory(root, ".staging");
    await ensurePrivateDirectory(root, "repositories");
  }

  /** Imports one approved spec/plan/approval revision as an immutable bundle. */
  async function importApprovedRevision(
    request: RevisionImportRequest,
  ): Promise<StoredBundle> {
    await initialize();
    const context = ArtifactContextSchema.parse(request.context);
    const revisionId = RevisionIdSchema.parse(request.revisionId);
    const sources: MigrationSource[] = [
      { sourcePath: "spec.md", storedPath: "spec.md" },
      { sourcePath: "plan.md", storedPath: "plan.md" },
      { sourcePath: "approval.md", storedPath: "approval.md" },
      ...(request.supportingFiles ?? []).map((sourcePath) => ({
        sourcePath,
        storedPath: `supporting/${sourcePath}`,
      })),
    ];
    const sourceDirectory = canonicalizePotentialPath(request.sourceDirectory);
    assertExternalSourceDirectory(sourceDirectory);
    const files = await inspectSources(sourceDirectory, sources);
    const approvalPath = await assertSafeSourceFile(
      sourceDirectory,
      "approval.md",
    );
    const approvalContent =
      await readFileWithoutFollowingSymlinks(approvalPath);
    const approved = parseApprovedHashes(approvalContent.toString("utf8"));
    const spec = files.find((file) => file.path === "spec.md");
    const plan = files.find((file) => file.path === "plan.md");
    const approval = files.find((file) => file.path === "approval.md");
    if (!spec || !plan || !approval) {
      throw artifactStoreError(
        "INVALID_ARTIFACT",
        "Approved revision requires spec.md, plan.md, and approval.md",
      );
    }
    if (approved.spec !== spec.sha256 || approved.plan !== plan.sha256) {
      throw artifactStoreError(
        "HASH_MISMATCH",
        "Approval hashes do not match spec.md and plan.md",
      );
    }
    if (
      request.expectedHashes &&
      (request.expectedHashes.spec !== spec.sha256 ||
        request.expectedHashes.plan !== plan.sha256)
    ) {
      throw artifactStoreError(
        "HASH_MISMATCH",
        "Approved lifecycle receipts do not match spec.md and plan.md",
      );
    }

    const manifest: RevisionBundleManifest = {
      schemaVersion: 1,
      kind: "revision",
      revisionId,
      context,
      createdAt: request.createdAt ?? new Date().toISOString(),
      approvedHashes: {
        spec: approved.spec,
        plan: approved.plan,
        approval: approval.sha256,
      },
      files,
    };
    const prepared: PreparedBundle = {
      sourceDirectory,
      sourceDisposition: "retire",
      destinationRelative: destinationRelative(manifest),
      manifest: ArtifactBundleManifestSchema.parse(manifest),
      sources,
    };
    return migrations.commitPrepared(
      prepared,
      request.migrationId ?? defaultMigrationId(prepared),
    );
  }

  /** Imports final verifier evidence and its readable artifacts immutably. */
  async function importEvidence(
    request: EvidenceImportRequest,
  ): Promise<StoredBundle> {
    await initialize();
    const context = EvidenceArtifactContextSchema.parse(request.context);
    const verdict = EvidenceVerdictSchema.parse(request.verdict);
    if (request.files.length === 0) {
      throw artifactStoreError(
        "INVALID_ARTIFACT",
        "Evidence import requires at least one readable artifact",
      );
    }
    const sources = request.files.map((sourcePath) => ({
      sourcePath,
      storedPath: sourcePath,
    }));
    const sourceDirectory = canonicalizePotentialPath(request.sourceDirectory);
    assertExternalSourceDirectory(sourceDirectory);
    const files = await inspectSources(sourceDirectory, sources);
    const manifest: EvidenceBundleManifest = {
      schemaVersion: 1,
      kind: "evidence",
      verdictId: verdict.id,
      verdict,
      context,
      createdAt: request.createdAt ?? new Date().toISOString(),
      files,
    };
    const prepared: PreparedBundle = {
      sourceDirectory,
      sourceDisposition: "retire",
      destinationRelative: destinationRelative(manifest),
      manifest: ArtifactBundleManifestSchema.parse(manifest),
      sources,
    };
    return migrations.commitPrepared(
      prepared,
      request.migrationId ?? defaultMigrationId(prepared),
    );
  }

  /** Resumes an interrupted import from its durable migration journal. */
  async function resumeMigration(migrationId: string): Promise<StoredBundle> {
    await initialize();
    const journal = await migrations.readJournal(migrationId);
    return migrations.continueJournal(journal);
  }

  /** Retires legacy source files only after the canonical bundle verifies. */
  async function retireMigrationSource(
    migrationId: string,
  ): Promise<StoredBundle> {
    await initialize();
    const journal = await migrations.readJournal(migrationId);
    if (journal.status === "copying") {
      throw artifactStoreError(
        "MIGRATION_CONFLICT",
        `Migration must commit before its source can be retired: ${migrationId}`,
      );
    }
    return migrations.continueRetirement(journal);
  }

  /** Recomputes every hash and permission check for one stored bundle. */
  async function verify(
    reference: ArtifactReference,
  ): Promise<ArtifactBundleManifest> {
    await initialize();
    return verifyBundleAt(bundleDirectory(reference));
  }

  /** Exports a self-contained readable bundle without weakening permissions. */
  async function exportBundle(
    reference: ArtifactReference,
    destinationDirectory: string,
  ): Promise<string> {
    const sourceDirectory = bundleDirectory(reference);
    const manifest = await verifyBundleAt(sourceDirectory);
    const canonicalDestination =
      canonicalizePotentialPath(destinationDirectory);
    if (pathsOverlap(canonicalDestination, root)) {
      throw artifactStoreError(
        "INVALID_PATH",
        "Export destination must not overlap the private store",
      );
    }
    await ensurePrivateDirectory(canonicalDestination);
    await removeAtomicTemporaryFiles(canonicalDestination, manifest);

    const manifestPath = path.join(canonicalDestination, "manifest.json");
    if (await pathExists(manifestPath)) {
      await verifyBundleAt(canonicalDestination, manifest);
      return canonicalDestination;
    }

    const existingFiles = await listPrivateBundleFiles(canonicalDestination);
    const allowedFiles = new Set(
      manifest.files.map((file) => portablePathKey(file.path)),
    );
    const unexpected = [...existingFiles].filter(
      (file) => !allowedFiles.has(portablePathKey(file)),
    );
    if (unexpected.length > 0) {
      throw artifactStoreError(
        "IMMUTABLE_CONFLICT",
        `Export destination contains conflicting files: ${unexpected.join(", ")}`,
      );
    }

    for (const file of manifest.files) {
      const source = await assertSafeSourceFile(sourceDirectory, file.path);
      const destination = resolveWithin(canonicalDestination, file.path);
      await ensurePrivateDirectoryForFile(canonicalDestination, file.path);
      if (await pathExists(destination)) {
        assertExpectedHash(await hashFile(destination), file, file.path);
      } else {
        await writePrivateFileAtomic(
          destination,
          await readFileWithoutFollowingSymlinks(source),
        );
      }
    }
    await writePrivateJson(manifestPath, manifest);
    await verifyBundleAt(canonicalDestination, manifest);
    return canonicalDestination;
  }

  /** Restores an exported bundle to its canonical immutable location. */
  async function restore(exportDirectory: string): Promise<StoredBundle> {
    await initialize();
    const sourceDirectory = canonicalizePotentialPath(exportDirectory);
    assertExternalSourceDirectory(sourceDirectory);
    const manifest = await verifyBundleAt(sourceDirectory);
    const prepared: PreparedBundle = {
      sourceDirectory,
      sourceDisposition: "preserve",
      destinationRelative: destinationRelative(manifest),
      manifest,
      sources: manifest.files.map((file) => ({
        sourcePath: file.path,
        storedPath: file.path,
      })),
    };
    const restoreIdentity = `${prepared.destinationRelative}\n${JSON.stringify(manifest)}`;
    return migrations.commitPrepared(
      prepared,
      `restore-${sha256(Buffer.from(restoreIdentity)).slice(0, 24)}`,
    );
  }

  function assertExternalSourceDirectory(sourceDirectory: string): void {
    if (pathsOverlap(sourceDirectory, root)) {
      throw artifactStoreError(
        "INVALID_PATH",
        "Artifact sources must be outside the private store",
      );
    }
  }

  async function inspectSources(
    sourceDirectory: string,
    sources: readonly MigrationSource[],
  ): Promise<StoredFile[]> {
    const storedPaths = new Set<string>([portablePathKey("manifest.json")]);
    const sourcePaths = new Set<string>();
    const files: StoredFile[] = [];
    for (const source of sources) {
      registerPortablePath(sourcePaths, source.sourcePath, "source artifact");
      registerPortablePath(storedPaths, source.storedPath, "stored artifact");
      const sourcePath = await assertSafeSourceFile(
        sourceDirectory,
        source.sourcePath,
      );
      const hash = await hashFile(sourcePath);
      files.push({ path: source.storedPath, ...hash });
    }
    return files.sort((left, right) => left.path.localeCompare(right.path));
  }

  async function verifyBundleAt(
    directory: string,
    expected?: ArtifactBundleManifest,
  ): Promise<ArtifactBundleManifest> {
    const manifestPath = await assertSafeSourceFile(directory, "manifest.json");
    const manifest = await readParsedJson(
      manifestPath,
      ArtifactBundleManifestSchema,
    );
    if (expected && JSON.stringify(manifest) !== JSON.stringify(expected)) {
      throw artifactStoreError(
        "IMMUTABLE_CONFLICT",
        `Stored manifest differs from the approved bundle: ${directory}`,
      );
    }

    const expectedPaths = new Set([portablePathKey("manifest.json")]);
    for (const file of manifest.files) {
      registerPortablePath(expectedPaths, file.path, "manifest artifact");
      const filePath = await assertSafeSourceFile(directory, file.path);
      assertExpectedHash(await hashFile(filePath), file, file.path);
    }

    await validateBundleSemantics(directory, manifest);

    const actualPaths = await listPrivateBundleFiles(directory);
    const actualPathKeys = new Set<string>();
    for (const actualPath of actualPaths) {
      registerPortablePath(actualPathKeys, actualPath, "stored bundle entry");
    }
    if (
      actualPathKeys.size !== expectedPaths.size ||
      [...expectedPaths].some((file) => !actualPathKeys.has(file))
    ) {
      throw artifactStoreError(
        "INVALID_ARTIFACT",
        `Bundle contains missing or untracked files: ${directory}`,
      );
    }
    return manifest;
  }

  async function validateBundleSemantics(
    directory: string,
    manifest: ArtifactBundleManifest,
  ): Promise<void> {
    const filesByPath = new Map(
      manifest.files.map((file) => [portablePathKey(file.path), file]),
    );
    if (manifest.kind === "revision") {
      const spec = filesByPath.get(portablePathKey("spec.md"));
      const plan = filesByPath.get(portablePathKey("plan.md"));
      const approval = filesByPath.get(portablePathKey("approval.md"));
      if (!spec || !plan || !approval) {
        throw artifactStoreError(
          "INVALID_ARTIFACT",
          "Revision bundle requires spec.md, plan.md, and approval.md",
        );
      }
      const approvalPath = await assertSafeSourceFile(directory, approval.path);
      const approved = parseApprovedHashes(
        (await readFileWithoutFollowingSymlinks(approvalPath)).toString("utf8"),
      );
      if (
        approved.spec !== spec.sha256 ||
        approved.plan !== plan.sha256 ||
        manifest.approvedHashes.spec !== spec.sha256 ||
        manifest.approvedHashes.plan !== plan.sha256 ||
        manifest.approvedHashes.approval !== approval.sha256
      ) {
        throw artifactStoreError(
          "HASH_MISMATCH",
          "Revision approval relationships do not match stored files",
        );
      }
      return;
    }

    if (manifest.verdictId !== manifest.verdict.id) {
      throw artifactStoreError(
        "INVALID_ARTIFACT",
        "Evidence manifest verdictId does not match verdict.id",
      );
    }
    for (const artifactReference of manifest.verdict.artifactReferences) {
      const referenceKey = portablePathKey(artifactReference);
      if (!filesByPath.has(referenceKey)) {
        throw artifactStoreError(
          "INVALID_ARTIFACT",
          `Evidence artifact reference is not stored: ${artifactReference}`,
        );
      }
    }
  }

  function bundleDirectory(reference: ArtifactReference): string {
    const context = {
      repositoryFingerprint: reference.repositoryFingerprint,
      workItemId: WorkItemIdSchema.parse(reference.workItemId),
    };
    const repositoryKey = repositoryStorageKey(context.repositoryFingerprint);
    const leaf =
      reference.kind === "revision"
        ? `revisions/${RevisionIdSchema.parse(reference.revisionId)}`
        : `evidence/${VerdictIdSchema.parse(reference.verdictId)}`;
    return resolveWithin(
      root,
      `repositories/${repositoryKey}/work-items/${context.workItemId}/${leaf}`,
    );
  }

  function destinationRelative(manifest: ArtifactBundleManifest): string {
    const repositoryKey = repositoryStorageKey(
      manifest.context.repositoryFingerprint,
    );
    const leaf =
      manifest.kind === "revision"
        ? `revisions/${manifest.revisionId}`
        : `evidence/${manifest.verdictId}`;
    return `repositories/${repositoryKey}/work-items/${manifest.context.workItemId}/${leaf}`;
  }

  function defaultMigrationId(prepared: PreparedBundle): string {
    return `import-${sha256(Buffer.from(prepared.destinationRelative)).slice(0, 24)}`;
  }

  return {
    root,
    initialize,
    importApprovedRevision,
    importEvidence,
    resumeMigration,
    retireMigrationSource,
    verify,
    export: exportBundle,
    restore,
  };
}

function registerPortablePath(
  paths: Set<string>,
  relativePath: string,
  description: string,
): string {
  const key = portablePathKey(relativePath);
  for (const existing of paths) {
    if (
      key === existing ||
      key.startsWith(`${existing}/`) ||
      existing.startsWith(`${key}/`)
    ) {
      throw artifactStoreError(
        "INVALID_ARTIFACT",
        `${description} collides with another portable path: ${relativePath}`,
      );
    }
  }
  paths.add(key);
  return key;
}

function pathsOverlap(leftPath: string, rightPath: string): boolean {
  const left = path.resolve(leftPath).toLowerCase();
  const right = path.resolve(rightPath).toLowerCase();
  return isPathInside(left, right) || isPathInside(right, left);
}

function isPathInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function repositoryStorageKey(repositoryFingerprint: string): string {
  return sha256(Buffer.from(repositoryFingerprint)).slice(0, 32);
}

async function removeAtomicTemporaryFiles(
  root: string,
  manifest: ArtifactBundleManifest,
): Promise<void> {
  for (const relativeFile of [
    ...manifest.files.map((file) => file.path),
    "manifest.json",
  ]) {
    await ensurePrivateDirectoryForFile(root, relativeFile);
    const destination = resolveWithin(root, relativeFile);
    const temporary = path.join(
      path.dirname(destination),
      `.${path.basename(destination)}.kriscard-tmp`,
    );
    if (!(await pathExists(temporary))) continue;
    const info = await lstat(temporary);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw artifactStoreError(
        "IMMUTABLE_CONFLICT",
        `Invalid atomic-write recovery file: ${temporary}`,
      );
    }
    await rm(temporary, { force: false });
    await syncDirectory(path.dirname(temporary));
  }
}

async function listPrivateBundleFiles(root: string): Promise<Set<string>> {
  const rootInfo = await lstat(root);
  if (rootInfo.isSymbolicLink()) {
    throw artifactStoreError(
      "SYMLINK_ESCAPE",
      `Bundle root is a symbolic link: ${root}`,
    );
  }
  if (!rootInfo.isDirectory() || (rootInfo.mode & 0o077) !== 0) {
    throw artifactStoreError(
      "INVALID_ARTIFACT",
      `Bundle root permissions are not user-only: ${root}`,
    );
  }
  const files = new Set<string>();
  const pending: Array<{ directory: string; relative: string }> = [
    { directory: root, relative: "" },
  ];
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;
    const entries = await readdir(current.directory, { withFileTypes: true });
    for (const entry of entries) {
      const relative = current.relative
        ? `${current.relative}/${entry.name}`
        : entry.name;
      const absolute = path.join(current.directory, entry.name);
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) {
        throw artifactStoreError(
          "SYMLINK_ESCAPE",
          `Bundle contains a symbolic link: ${absolute}`,
        );
      }
      if ((info.mode & 0o077) !== 0) {
        throw artifactStoreError(
          "INVALID_ARTIFACT",
          `Bundle permissions are not user-only: ${absolute}`,
        );
      }
      if (info.isDirectory()) {
        pending.push({ directory: absolute, relative });
      } else if (info.isFile()) {
        files.add(relative);
      } else {
        throw artifactStoreError(
          "INVALID_ARTIFACT",
          `Bundle contains an unsupported entry: ${absolute}`,
        );
      }
    }
  }
  return files;
}
