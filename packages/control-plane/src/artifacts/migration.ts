import { rename, rm, unlink } from "node:fs/promises";
import path from "node:path";

import { artifactStoreError } from "./errors.js";
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
  ensurePrivateDirectory,
  readFileWithoutFollowingSymlinks,
  resolveWithin,
} from "./paths.js";
import {
  MigrationJournalSchema,
  type ArtifactBundleManifest,
  type MigrationJournal,
  type MigrationSource,
} from "./schemas.js";
import {
  assertExpectedHash,
  ensurePrivateDirectoryForFile,
  ensurePrivateDirectoryForRelativeDirectory,
  pathExists,
} from "./storage-helpers.js";

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

export interface StoredBundle {
  directory: string;
  manifest: ArtifactBundleManifest;
  migrationId: string;
}

export interface PreparedBundle {
  sourceDirectory: string;
  sourceDisposition: "retire" | "preserve";
  destinationRelative: string;
  manifest: ArtifactBundleManifest;
  sources: MigrationSource[];
}

interface MigrationOptions {
  root: string;
  verifyBundleAt: (
    directory: string,
    expected?: ArtifactBundleManifest,
  ) => Promise<ArtifactBundleManifest>;
  assertExternalSourceDirectory: (directory: string) => void;
  onCheckpoint:
    | ((checkpoint: MigrationCheckpoint) => void | Promise<void>)
    | undefined;
}

export function createMigrationOperations(options: MigrationOptions) {
  const { root, verifyBundleAt, assertExternalSourceDirectory, onCheckpoint } =
    options;

  async function commitPrepared(
    prepared: PreparedBundle,
    migrationId: string,
  ): Promise<StoredBundle> {
    assertMigrationId(migrationId);
    if (
      prepared.sourceDisposition === "retire" &&
      isRestoreMigrationId(
        migrationId,
        prepared.destinationRelative,
        prepared.manifest,
      )
    ) {
      throw artifactStoreError(
        "MIGRATION_CONFLICT",
        `Migration ID is reserved for a restore: ${migrationId}`,
      );
    }
    const existingJournal = await tryReadJournal(migrationId);
    if (existingJournal) {
      if (!journalsMatchPrepared(existingJournal, prepared)) {
        throw artifactStoreError(
          "MIGRATION_CONFLICT",
          `Migration ID is already bound to different artifacts: ${migrationId}`,
        );
      }
      return continueJournal(existingJournal);
    }

    const destination = resolveWithin(root, prepared.destinationRelative);
    if (await pathExists(destination)) {
      const manifest = await verifyBundleAt(destination, prepared.manifest);
      await syncDirectory(path.dirname(destination));
      const committedJournal: MigrationJournal = {
        schemaVersion: 1,
        migrationId,
        status: "committed",
        sourceDirectory: prepared.sourceDirectory,
        sourceDisposition: prepared.sourceDisposition,
        destinationRelative: prepared.destinationRelative,
        manifest: prepared.manifest,
        sources: prepared.sources,
        retiredFiles: [],
        updatedAt: new Date().toISOString(),
      };
      await writeJournal(committedJournal);
      return { directory: destination, manifest, migrationId };
    }

    const journal: MigrationJournal = {
      schemaVersion: 1,
      migrationId,
      status: "copying",
      sourceDirectory: prepared.sourceDirectory,
      sourceDisposition: prepared.sourceDisposition,
      destinationRelative: prepared.destinationRelative,
      manifest: prepared.manifest,
      sources: prepared.sources,
      retiredFiles: [],
      updatedAt: new Date().toISOString(),
    };
    await writeJournal(journal);
    return continueJournal(journal);
  }

  async function continueJournal(
    initialJournal: MigrationJournal,
  ): Promise<StoredBundle> {
    let journal = initialJournal;
    const destination = resolveWithin(root, journal.destinationRelative);
    if (journal.status === "retiring") {
      return continueRetirement(journal);
    }
    if (journal.status === "committed" || journal.status === "retired") {
      const manifest = await verifyBundleAt(destination, journal.manifest);
      return {
        directory: destination,
        manifest,
        migrationId: journal.migrationId,
      };
    }

    if (await pathExists(destination)) {
      const manifest = await verifyBundleAt(destination, journal.manifest);
      await syncDirectory(path.dirname(destination));
      await syncDirectory(
        path.dirname(resolveWithin(root, `.staging/${journal.migrationId}`)),
      );
      journal = await markCommitted(journal);
      return {
        directory: destination,
        manifest,
        migrationId: journal.migrationId,
      };
    }

    const stagingRelative = `.staging/${journal.migrationId}`;
    const staging = await ensurePrivateDirectory(root, stagingRelative);

    for (const source of journal.sources) {
      const expected = journal.manifest.files.find(
        (file) => file.path === source.storedPath,
      );
      if (!expected) {
        throw artifactStoreError(
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
        await checkpoint({
          migrationId: journal.migrationId,
          phase: "file_copied",
          storedPath: source.storedPath,
        });
      }
    }

    await writePrivateJson(
      path.join(staging, "manifest.json"),
      journal.manifest,
    );
    await verifyBundleAt(staging, journal.manifest);
    await checkpoint({
      migrationId: journal.migrationId,
      phase: "before_commit",
    });

    await ensurePrivateDirectoryForRelativeDirectory(
      root,
      journal.destinationRelative,
    );
    let renamed = false;
    try {
      await rename(staging, destination);
      renamed = true;
    } catch (error) {
      if (!(await pathExists(destination))) throw error;
      await verifyBundleAt(destination, journal.manifest);
      await rm(staging, { recursive: true, force: true });
    }
    await syncDirectory(path.dirname(destination));
    await syncDirectory(path.dirname(staging));
    if (!renamed) {
      await verifyBundleAt(destination, journal.manifest);
    }

    journal = await markCommitted(journal);
    await checkpoint({
      migrationId: journal.migrationId,
      phase: "committed",
    });
    const manifest = await verifyBundleAt(destination, journal.manifest);
    return {
      directory: destination,
      manifest,
      migrationId: journal.migrationId,
    };
  }

  async function continueRetirement(
    initialJournal: MigrationJournal,
  ): Promise<StoredBundle> {
    let journal = initialJournal;
    if (journalSourceDisposition(journal) !== "retire") {
      throw artifactStoreError(
        "MIGRATION_CONFLICT",
        `Source retirement is not allowed for this operation: ${journal.migrationId}`,
      );
    }
    assertExternalSourceDirectory(journal.sourceDirectory);
    const destination = resolveWithin(root, journal.destinationRelative);
    const manifest = await verifyBundleAt(destination, journal.manifest);
    if (journal.status === "retired") {
      return {
        directory: destination,
        manifest,
        migrationId: journal.migrationId,
      };
    }
    if (journal.status === "copying") {
      throw artifactStoreError(
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
      await writeJournal(journal);
    }

    const retired = new Set(journal.retiredFiles ?? []);
    for (const source of journal.sources) {
      if (retired.has(source.sourcePath)) continue;
      const expected = journal.manifest.files.find(
        (file) => file.path === source.storedPath,
      );
      if (!expected) {
        throw artifactStoreError(
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
      await writeJournal(journal);
      await checkpoint({
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
    await writeJournal(journal);
    await checkpoint({
      migrationId: journal.migrationId,
      phase: "retired",
    });
    return {
      directory: destination,
      manifest,
      migrationId: journal.migrationId,
    };
  }

  function journalPath(migrationId: string): string {
    assertMigrationId(migrationId);
    return resolveWithin(root, `.migrations/${migrationId}.json`);
  }

  async function tryReadJournal(
    migrationId: string,
  ): Promise<MigrationJournal | undefined> {
    const filePath = journalPath(migrationId);
    if (!(await pathExists(filePath))) return undefined;
    return readParsedJson(filePath, MigrationJournalSchema);
  }

  async function readJournal(migrationId: string): Promise<MigrationJournal> {
    const journal = await tryReadJournal(migrationId);
    if (!journal) {
      throw artifactStoreError(
        "MIGRATION_CONFLICT",
        `Unknown migration: ${migrationId}`,
      );
    }
    return journal;
  }

  async function writeJournal(journal: MigrationJournal): Promise<void> {
    await writePrivateJson(journalPath(journal.migrationId), journal);
  }

  async function markCommitted(
    journal: MigrationJournal,
  ): Promise<MigrationJournal> {
    const committed: MigrationJournal = {
      ...journal,
      status: "committed",
      updatedAt: new Date().toISOString(),
    };
    await writeJournal(committed);
    return committed;
  }

  async function checkpoint(checkpoint: MigrationCheckpoint): Promise<void> {
    await onCheckpoint?.(checkpoint);
  }

  return { commitPrepared, continueJournal, continueRetirement, readJournal };
}

function assertMigrationId(migrationId: string): void {
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(migrationId)) {
    throw artifactStoreError(
      "INVALID_PATH",
      `Invalid migration ID: ${migrationId}`,
    );
  }
}

function journalSourceDisposition(
  journal: MigrationJournal,
): "retire" | "preserve" {
  if (journal.sourceDisposition) return journal.sourceDisposition;
  return isRestoreMigrationId(
    journal.migrationId,
    journal.destinationRelative,
    journal.manifest,
  )
    ? "preserve"
    : "retire";
}

function isRestoreMigrationId(
  migrationId: string,
  destinationRelative: string,
  manifest: ArtifactBundleManifest,
): boolean {
  // The first restore format used the destination alone; later restores bind the manifest too.
  const oldId = `restore-${sha256(Buffer.from(destinationRelative)).slice(0, 24)}`;
  const currentId = `restore-${sha256(Buffer.from(`${destinationRelative}\n${JSON.stringify(manifest)}`)).slice(0, 24)}`;
  return migrationId === oldId || migrationId === currentId;
}

function journalsMatchPrepared(
  journal: MigrationJournal,
  prepared: PreparedBundle,
): boolean {
  return (
    journal.sourceDirectory === prepared.sourceDirectory &&
    journalSourceDisposition(journal) === prepared.sourceDisposition &&
    journal.destinationRelative === prepared.destinationRelative &&
    comparableManifest(journal.manifest) ===
      comparableManifest(prepared.manifest) &&
    JSON.stringify(journal.sources) === JSON.stringify(prepared.sources)
  );
}

function comparableManifest(manifest: ArtifactBundleManifest): string {
  return JSON.stringify({ ...manifest, createdAt: "" });
}
