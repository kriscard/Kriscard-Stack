import { lstat, readdir, rename, rm, unlink } from "node:fs/promises";
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
import { ArtifactStoreError } from "./errors.js";
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
  MigrationJournalSchema,
  type ArtifactBundleManifest,
  type ArtifactContext,
  type EvidenceArtifactContext,
  type EvidenceBundleManifest,
  type MigrationJournal,
  type MigrationSource,
  type RevisionBundleManifest,
  type StoredFile,
} from "./schemas.js";

export type MigrationPhase =
  | "file_copied"
  | "before_commit"
  | "committed"
  | "source_retired"
  | "retired";

export interface MigrationCheckpoint {
  migrationId: string;
  phase: MigrationPhase;
  storedPath?: string;
}

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

export interface StoredBundle {
  directory: string;
  manifest: ArtifactBundleManifest;
  migrationId: string;
}

interface PreparedBundle {
  sourceDirectory: string;
  destinationRelative: string;
  manifest: ArtifactBundleManifest;
  sources: MigrationSource[];
}

/** Stores immutable approved revisions and evidence outside application repositories. */
export class ArtifactStore {
  readonly root: string;
  readonly onCheckpoint:
    | ((checkpoint: MigrationCheckpoint) => void | Promise<void>)
    | undefined;

  constructor(options: ArtifactStoreOptions = {}) {
    this.root = canonicalizePotentialPath(
      options.root ?? defaultArtifactRoot(),
    );
    this.onCheckpoint = options.onCheckpoint;
  }

  async initialize(): Promise<void> {
    await ensurePrivateDirectory(this.root);
    await ensurePrivateDirectory(this.root, ".migrations");
    await ensurePrivateDirectory(this.root, ".staging");
    await ensurePrivateDirectory(this.root, "repositories");
  }

  /** Imports one approved spec/plan/approval revision as an immutable bundle. */
  async importApprovedRevision(
    request: RevisionImportRequest,
  ): Promise<StoredBundle> {
    await this.initialize();
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
    const files = await this.inspectSources(sourceDirectory, sources);
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
      throw new ArtifactStoreError(
        "INVALID_ARTIFACT",
        "Approved revision requires spec.md, plan.md, and approval.md",
      );
    }
    if (approved.spec !== spec.sha256 || approved.plan !== plan.sha256) {
      throw new ArtifactStoreError(
        "HASH_MISMATCH",
        "Approval hashes do not match spec.md and plan.md",
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
      destinationRelative: this.destinationRelative(manifest),
      manifest: ArtifactBundleManifestSchema.parse(manifest),
      sources,
    };
    return this.commitPrepared(
      prepared,
      request.migrationId ?? this.defaultMigrationId(prepared),
    );
  }

  /** Imports final verifier evidence and its readable artifacts immutably. */
  async importEvidence(request: EvidenceImportRequest): Promise<StoredBundle> {
    await this.initialize();
    const context = EvidenceArtifactContextSchema.parse(request.context);
    const verdict = EvidenceVerdictSchema.parse(request.verdict);
    if (request.files.length === 0) {
      throw new ArtifactStoreError(
        "INVALID_ARTIFACT",
        "Evidence import requires at least one readable artifact",
      );
    }
    const sources = request.files.map((sourcePath) => ({
      sourcePath,
      storedPath: sourcePath,
    }));
    const sourceDirectory = canonicalizePotentialPath(request.sourceDirectory);
    const files = await this.inspectSources(sourceDirectory, sources);
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
      destinationRelative: this.destinationRelative(manifest),
      manifest: ArtifactBundleManifestSchema.parse(manifest),
      sources,
    };
    return this.commitPrepared(
      prepared,
      request.migrationId ?? this.defaultMigrationId(prepared),
    );
  }

  /** Resumes an interrupted import from its durable migration journal. */
  async resumeMigration(migrationId: string): Promise<StoredBundle> {
    await this.initialize();
    const journal = await this.readJournal(migrationId);
    return this.continueJournal(journal);
  }

  /** Retires legacy source files only after the canonical bundle verifies. */
  async retireMigrationSource(migrationId: string): Promise<StoredBundle> {
    await this.initialize();
    const journal = await this.readJournal(migrationId);
    if (journal.status === "copying") {
      throw new ArtifactStoreError(
        "MIGRATION_CONFLICT",
        `Migration must commit before its source can be retired: ${migrationId}`,
      );
    }
    return this.continueRetirement(journal);
  }

  /** Recomputes every hash and permission check for one stored bundle. */
  async verify(reference: ArtifactReference): Promise<ArtifactBundleManifest> {
    await this.initialize();
    return this.verifyBundleAt(this.bundleDirectory(reference));
  }

  /** Exports a self-contained readable bundle without weakening permissions. */
  async export(
    reference: ArtifactReference,
    destinationDirectory: string,
  ): Promise<string> {
    const sourceDirectory = this.bundleDirectory(reference);
    const manifest = await this.verifyBundleAt(sourceDirectory);
    const canonicalDestination =
      canonicalizePotentialPath(destinationDirectory);
    if (pathsOverlap(canonicalDestination, this.root)) {
      throw new ArtifactStoreError(
        "INVALID_PATH",
        "Export destination must not overlap the private store",
      );
    }
    await ensurePrivateDirectory(canonicalDestination);
    await removeAtomicTemporaryFiles(canonicalDestination, manifest);

    const manifestPath = path.join(canonicalDestination, "manifest.json");
    if (await pathExists(manifestPath)) {
      await this.verifyBundleAt(canonicalDestination, manifest);
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
      throw new ArtifactStoreError(
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
    await this.verifyBundleAt(canonicalDestination, manifest);
    return canonicalDestination;
  }

  /** Restores an exported bundle to its canonical immutable location. */
  async restore(exportDirectory: string): Promise<StoredBundle> {
    await this.initialize();
    const sourceDirectory = canonicalizePotentialPath(exportDirectory);
    const manifest = await this.verifyBundleAt(sourceDirectory);
    const prepared: PreparedBundle = {
      sourceDirectory,
      destinationRelative: this.destinationRelative(manifest),
      manifest,
      sources: manifest.files.map((file) => ({
        sourcePath: file.path,
        storedPath: file.path,
      })),
    };
    const restoreIdentity = `${prepared.destinationRelative}\n${JSON.stringify(manifest)}`;
    return this.commitPrepared(
      prepared,
      `restore-${sha256(Buffer.from(restoreIdentity)).slice(0, 24)}`,
    );
  }

  private async inspectSources(
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

  private async commitPrepared(
    prepared: PreparedBundle,
    migrationId: string,
  ): Promise<StoredBundle> {
    assertMigrationId(migrationId);
    const existingJournal = await this.tryReadJournal(migrationId);
    if (existingJournal) {
      if (!journalsMatchPrepared(existingJournal, prepared)) {
        throw new ArtifactStoreError(
          "MIGRATION_CONFLICT",
          `Migration ID is already bound to different artifacts: ${migrationId}`,
        );
      }
      return this.continueJournal(existingJournal);
    }

    const destination = resolveWithin(this.root, prepared.destinationRelative);
    if (await pathExists(destination)) {
      const manifest = await this.verifyBundleAt(
        destination,
        prepared.manifest,
      );
      await syncDirectory(path.dirname(destination));
      const committedJournal: MigrationJournal = {
        schemaVersion: 1,
        migrationId,
        status: "committed",
        sourceDirectory: prepared.sourceDirectory,
        destinationRelative: prepared.destinationRelative,
        manifest: prepared.manifest,
        sources: prepared.sources,
        completedFiles: prepared.manifest.files.map((file) => file.path),
        retiredFiles: [],
        updatedAt: new Date().toISOString(),
      };
      await this.writeJournal(committedJournal);
      return { directory: destination, manifest, migrationId };
    }

    const journal: MigrationJournal = {
      schemaVersion: 1,
      migrationId,
      status: "copying",
      sourceDirectory: prepared.sourceDirectory,
      destinationRelative: prepared.destinationRelative,
      manifest: prepared.manifest,
      sources: prepared.sources,
      completedFiles: [],
      retiredFiles: [],
      updatedAt: new Date().toISOString(),
    };
    await this.writeJournal(journal);
    return this.continueJournal(journal);
  }

  private async continueJournal(
    initialJournal: MigrationJournal,
  ): Promise<StoredBundle> {
    let journal = initialJournal;
    const destination = resolveWithin(this.root, journal.destinationRelative);
    if (journal.status === "retiring") {
      return this.continueRetirement(journal);
    }
    if (journal.status === "committed" || journal.status === "retired") {
      const manifest = await this.verifyBundleAt(destination, journal.manifest);
      return {
        directory: destination,
        manifest,
        migrationId: journal.migrationId,
      };
    }

    if (await pathExists(destination)) {
      const manifest = await this.verifyBundleAt(destination, journal.manifest);
      await syncDirectory(path.dirname(destination));
      await syncDirectory(
        path.dirname(
          resolveWithin(this.root, `.staging/${journal.migrationId}`),
        ),
      );
      journal = await this.markCommitted(journal);
      return {
        directory: destination,
        manifest,
        migrationId: journal.migrationId,
      };
    }

    const stagingRelative = `.staging/${journal.migrationId}`;
    const staging = await ensurePrivateDirectory(this.root, stagingRelative);
    const completed = new Set(journal.completedFiles);

    for (const source of journal.sources) {
      const expected = journal.manifest.files.find(
        (file) => file.path === source.storedPath,
      );
      if (!expected) {
        throw new ArtifactStoreError(
          "MIGRATION_CONFLICT",
          `Migration source is absent from its manifest: ${source.storedPath}`,
        );
      }
      const stagedPath = resolveWithin(staging, source.storedPath);
      await ensurePrivateDirectoryForFile(staging, source.storedPath);
      if (await pathExists(stagedPath)) {
        assertExpectedHash(
          await hashFile(stagedPath),
          expected,
          source.storedPath,
        );
      } else {
        const sourcePath = await assertSafeSourceFile(
          journal.sourceDirectory,
          source.sourcePath,
        );
        const sourceHash = await hashFile(sourcePath);
        assertExpectedHash(sourceHash, expected, source.sourcePath);
        await writePrivateFileAtomic(
          stagedPath,
          await readFileWithoutFollowingSymlinks(sourcePath),
        );
        await this.checkpoint({
          migrationId: journal.migrationId,
          phase: "file_copied",
          storedPath: source.storedPath,
        });
      }

      if (!completed.has(source.storedPath)) {
        completed.add(source.storedPath);
        journal = {
          ...journal,
          completedFiles: [...completed],
          updatedAt: new Date().toISOString(),
        };
        await this.writeJournal(journal);
      }
    }

    await writePrivateJson(
      path.join(staging, "manifest.json"),
      journal.manifest,
    );
    await this.verifyBundleAt(staging, journal.manifest);
    await this.checkpoint({
      migrationId: journal.migrationId,
      phase: "before_commit",
    });

    await ensurePrivateDirectoryForRelativeDirectory(
      this.root,
      journal.destinationRelative,
    );
    let renamed = false;
    try {
      await rename(staging, destination);
      renamed = true;
    } catch (error) {
      if (!(await pathExists(destination))) throw error;
      await this.verifyBundleAt(destination, journal.manifest);
      await rm(staging, { recursive: true, force: true });
    }
    await syncDirectory(path.dirname(destination));
    await syncDirectory(path.dirname(staging));
    if (!renamed) {
      await this.verifyBundleAt(destination, journal.manifest);
    }

    journal = await this.markCommitted(journal);
    await this.checkpoint({
      migrationId: journal.migrationId,
      phase: "committed",
    });
    const manifest = await this.verifyBundleAt(destination, journal.manifest);
    return {
      directory: destination,
      manifest,
      migrationId: journal.migrationId,
    };
  }

  private async continueRetirement(
    initialJournal: MigrationJournal,
  ): Promise<StoredBundle> {
    let journal = initialJournal;
    const destination = resolveWithin(this.root, journal.destinationRelative);
    const manifest = await this.verifyBundleAt(destination, journal.manifest);
    if (journal.status === "retired") {
      return {
        directory: destination,
        manifest,
        migrationId: journal.migrationId,
      };
    }
    if (journal.status === "copying") {
      throw new ArtifactStoreError(
        "MIGRATION_CONFLICT",
        `Migration has not committed: ${journal.migrationId}`,
      );
    }
    if (journal.status === "committed") {
      journal = {
        ...journal,
        status: "retiring",
        updatedAt: new Date().toISOString(),
      };
      await this.writeJournal(journal);
    }

    const retired = new Set(journal.retiredFiles ?? []);
    for (const source of journal.sources) {
      if (retired.has(source.sourcePath)) continue;
      const expected = journal.manifest.files.find(
        (file) => file.path === source.storedPath,
      );
      if (!expected) {
        throw new ArtifactStoreError(
          "MIGRATION_CONFLICT",
          `Retirement source is absent from its manifest: ${source.storedPath}`,
        );
      }
      const sourcePath = resolveWithin(
        journal.sourceDirectory,
        source.sourcePath,
      );
      if (await pathExists(sourcePath)) {
        const safeSource = await assertSafeSourceFile(
          journal.sourceDirectory,
          source.sourcePath,
        );
        assertExpectedHash(
          await hashFile(safeSource),
          expected,
          source.sourcePath,
        );
        await unlink(safeSource);
        await syncDirectory(path.dirname(safeSource));
      }
      retired.add(source.sourcePath);
      journal = {
        ...journal,
        retiredFiles: [...retired],
        updatedAt: new Date().toISOString(),
      };
      await this.writeJournal(journal);
      await this.checkpoint({
        migrationId: journal.migrationId,
        phase: "source_retired",
        storedPath: source.sourcePath,
      });
    }

    journal = {
      ...journal,
      status: "retired",
      updatedAt: new Date().toISOString(),
    };
    await this.writeJournal(journal);
    await this.checkpoint({
      migrationId: journal.migrationId,
      phase: "retired",
    });
    return {
      directory: destination,
      manifest,
      migrationId: journal.migrationId,
    };
  }

  private async verifyBundleAt(
    directory: string,
    expected?: ArtifactBundleManifest,
  ): Promise<ArtifactBundleManifest> {
    const manifestPath = await assertSafeSourceFile(directory, "manifest.json");
    const manifest = await readParsedJson(
      manifestPath,
      ArtifactBundleManifestSchema,
    );
    if (expected && JSON.stringify(manifest) !== JSON.stringify(expected)) {
      throw new ArtifactStoreError(
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

    await this.validateBundleSemantics(directory, manifest);

    const actualPaths = await listPrivateBundleFiles(directory);
    const actualPathKeys = new Set<string>();
    for (const actualPath of actualPaths) {
      registerPortablePath(actualPathKeys, actualPath, "stored bundle entry");
    }
    if (
      actualPathKeys.size !== expectedPaths.size ||
      [...expectedPaths].some((file) => !actualPathKeys.has(file))
    ) {
      throw new ArtifactStoreError(
        "INVALID_ARTIFACT",
        `Bundle contains missing or untracked files: ${directory}`,
      );
    }
    return manifest;
  }

  private async validateBundleSemantics(
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
        throw new ArtifactStoreError(
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
        throw new ArtifactStoreError(
          "HASH_MISMATCH",
          "Revision approval relationships do not match stored files",
        );
      }
      return;
    }

    if (manifest.verdictId !== manifest.verdict.id) {
      throw new ArtifactStoreError(
        "INVALID_ARTIFACT",
        "Evidence manifest verdictId does not match verdict.id",
      );
    }
    for (const artifactReference of manifest.verdict.artifactReferences) {
      const referenceKey = portablePathKey(artifactReference);
      if (!filesByPath.has(referenceKey)) {
        throw new ArtifactStoreError(
          "INVALID_ARTIFACT",
          `Evidence artifact reference is not stored: ${artifactReference}`,
        );
      }
    }
  }

  private bundleDirectory(reference: ArtifactReference): string {
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
      this.root,
      `repositories/${repositoryKey}/work-items/${context.workItemId}/${leaf}`,
    );
  }

  private destinationRelative(manifest: ArtifactBundleManifest): string {
    const repositoryKey = repositoryStorageKey(
      manifest.context.repositoryFingerprint,
    );
    const leaf =
      manifest.kind === "revision"
        ? `revisions/${manifest.revisionId}`
        : `evidence/${manifest.verdictId}`;
    return `repositories/${repositoryKey}/work-items/${manifest.context.workItemId}/${leaf}`;
  }

  private defaultMigrationId(prepared: PreparedBundle): string {
    return `import-${sha256(Buffer.from(prepared.destinationRelative)).slice(0, 24)}`;
  }

  private journalPath(migrationId: string): string {
    assertMigrationId(migrationId);
    return resolveWithin(this.root, `.migrations/${migrationId}.json`);
  }

  private async tryReadJournal(
    migrationId: string,
  ): Promise<MigrationJournal | undefined> {
    const journalPath = this.journalPath(migrationId);
    if (!(await pathExists(journalPath))) return undefined;
    return readParsedJson(journalPath, MigrationJournalSchema);
  }

  private async readJournal(migrationId: string): Promise<MigrationJournal> {
    const journal = await this.tryReadJournal(migrationId);
    if (!journal) {
      throw new ArtifactStoreError(
        "MIGRATION_CONFLICT",
        `Unknown migration: ${migrationId}`,
      );
    }
    return journal;
  }

  private async writeJournal(journal: MigrationJournal): Promise<void> {
    await writePrivateJson(this.journalPath(journal.migrationId), journal);
  }

  private async markCommitted(
    journal: MigrationJournal,
  ): Promise<MigrationJournal> {
    const committed: MigrationJournal = {
      ...journal,
      status: "committed",
      updatedAt: new Date().toISOString(),
    };
    await this.writeJournal(committed);
    return committed;
  }

  private async checkpoint(checkpoint: MigrationCheckpoint): Promise<void> {
    await this.onCheckpoint?.(checkpoint);
  }
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
      throw new ArtifactStoreError(
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

function assertMigrationId(migrationId: string): void {
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(migrationId)) {
    throw new ArtifactStoreError(
      "INVALID_PATH",
      `Invalid migration ID: ${migrationId}`,
    );
  }
}

function assertExpectedHash(
  actual: { sha256: string; size: number },
  expected: StoredFile,
  fileName: string,
): void {
  if (actual.sha256 !== expected.sha256 || actual.size !== expected.size) {
    throw new ArtifactStoreError(
      "HASH_MISMATCH",
      `Artifact hash or size changed: ${fileName}`,
    );
  }
}

function journalsMatchPrepared(
  journal: MigrationJournal,
  prepared: PreparedBundle,
): boolean {
  return (
    journal.sourceDirectory === prepared.sourceDirectory &&
    journal.destinationRelative === prepared.destinationRelative &&
    comparableManifest(journal.manifest) ===
      comparableManifest(prepared.manifest) &&
    JSON.stringify(journal.sources) === JSON.stringify(prepared.sources)
  );
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
      throw new ArtifactStoreError(
        "IMMUTABLE_CONFLICT",
        `Invalid atomic-write recovery file: ${temporary}`,
      );
    }
    await rm(temporary, { force: false });
    await syncDirectory(path.dirname(temporary));
  }
}

async function ensurePrivateDirectoryForFile(
  root: string,
  relativeFile: string,
): Promise<void> {
  const parent = path.posix.dirname(relativeFile);
  if (parent === ".") return;
  await ensurePrivateDirectory(root, parent);
}

async function ensurePrivateDirectoryForRelativeDirectory(
  root: string,
  relativeDirectory: string,
): Promise<void> {
  const parent = path.posix.dirname(relativeDirectory);
  if (parent === ".") return;
  await ensurePrivateDirectory(root, parent);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function comparableManifest(manifest: ArtifactBundleManifest): string {
  return JSON.stringify({ ...manifest, createdAt: "" });
}

async function listPrivateBundleFiles(root: string): Promise<Set<string>> {
  const rootInfo = await lstat(root);
  if (rootInfo.isSymbolicLink()) {
    throw new ArtifactStoreError(
      "SYMLINK_ESCAPE",
      `Bundle root is a symbolic link: ${root}`,
    );
  }
  if (!rootInfo.isDirectory() || (rootInfo.mode & 0o077) !== 0) {
    throw new ArtifactStoreError(
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
        throw new ArtifactStoreError(
          "SYMLINK_ESCAPE",
          `Bundle contains a symbolic link: ${absolute}`,
        );
      }
      if ((info.mode & 0o077) !== 0) {
        throw new ArtifactStoreError(
          "INVALID_ARTIFACT",
          `Bundle permissions are not user-only: ${absolute}`,
        );
      }
      if (info.isDirectory()) {
        pending.push({ directory: absolute, relative });
      } else if (info.isFile()) {
        files.add(relative);
      } else {
        throw new ArtifactStoreError(
          "INVALID_ARTIFACT",
          `Bundle contains an unsupported entry: ${absolute}`,
        );
      }
    }
  }
  return files;
}
