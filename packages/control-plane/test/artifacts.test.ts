import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, type TestContext } from "vitest";

import {
  createId,
  type EvidenceCategory,
  type EvidenceVerdict,
} from "@kriscard/core";

import {
  ArtifactBundleManifestSchema,
  ArtifactContextSchema,
  createArtifactStore,
  isArtifactStoreError,
  EvidenceArtifactContextSchema,
  MigrationJournalSchema,
  type ArtifactReference,
  type EvidenceArtifactContext,
} from "../src/artifacts/index.js";
import {
  assertSafeRelativePath,
  defaultArtifactRoot,
  portablePathKey,
} from "../src/artifacts/paths.js";

const createdAt = "2026-10-08T00:00:00Z";

function digest(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function approvalMarkdown(spec: string, plan: string): string {
  return `# Approval\n\nStatus: Approved\nMethod: Plannotator\nApproved at: ${createdAt}\n\n## Approved artifacts\n\n- \`spec.md\`\n  - SHA-256: \`${digest(spec)}\`\n- \`plan.md\`\n  - SHA-256: \`${digest(plan)}\`\n\n## Stage approvals\n\n- Requirements: The previously approved Requirements layer is unchanged.\n- Technical Design: Plannotator returned \`approved\` for the current \`spec.md\`.\n- Plan: Plannotator returned \`approved\` for the current \`plan.md\`.\n\n## Exceptions\n\nNone.\n`;
}

function createContext(): EvidenceArtifactContext {
  return {
    repositoryFingerprint: "github.com/kriscard/Kriscard-Stack",
    targetBranch: "main",
    startingCommit: "a".repeat(40),
    workItemId: createId("workItem", randomUUID()),
    taskGroup: "P3",
    branch: "feat/private-artifacts",
    pullRequest: 3,
  };
}

async function createApprovedSource(
  root: string,
  spec = "# Specification\n",
  plan = "# Plan\n",
): Promise<string> {
  const source = path.join(root, "approved-source");
  await mkdir(source, { recursive: true });
  const approval = approvalMarkdown(spec, plan);
  await writeFile(path.join(source, "spec.md"), spec);
  await writeFile(path.join(source, "plan.md"), plan);
  await writeFile(path.join(source, "approval.md"), approval);
  return source;
}

async function temporaryTestRoot(context: TestContext): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "kriscard-artifacts-"));
  context.onTestFinished(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function writeLegacyJournal(journalPath: string): Promise<void> {
  const journal = MigrationJournalSchema.parse(
    JSON.parse(await readFile(journalPath, "utf8")),
  );
  const { sourceDisposition: _disposition, ...legacyJournal } = journal;
  await writeFile(journalPath, `${JSON.stringify(legacyJournal, null, 2)}\n`, {
    mode: 0o600,
  });
}

test("creates a missing private data hierarchy and rejects relative XDG paths", async (t) => {
  const temporary = await temporaryTestRoot(t);
  const root = path.join(temporary, "missing", "data", "kriscard-stack");
  const store = createArtifactStore({ root });

  await store.initialize();

  assert.equal((await stat(root)).mode & 0o777, 0o700);
  assert.throws(
    () => defaultArtifactRoot({ XDG_DATA_HOME: "relative/data" }, temporary),
    /XDG_DATA_HOME must be an absolute path/,
  );
});

test("rejects existing shared roots without changing their permissions", async (t) => {
  const temporary = await temporaryTestRoot(t);
  const sharedRoot = path.join(temporary, "shared-root");
  await mkdir(sharedRoot, { mode: 0o755 });
  await chmod(sharedRoot, 0o755);
  const store = createArtifactStore({ root: sharedRoot });

  await assert.rejects(
    store.initialize(),
    (error) => isArtifactStoreError(error) && error.code === "INVALID_PATH",
  );
  assert.equal((await stat(sharedRoot)).mode & 0o777, 0o755);
});

test("requires branch association and an explicit PR lifecycle", () => {
  const context = createContext();
  assert.equal(ArtifactContextSchema.validate(context), true);
  assert.equal(
    ArtifactContextSchema.validate({ ...context, pullRequest: null }),
    true,
  );
  assert.equal(
    ArtifactContextSchema.validate({ ...context, branch: undefined }),
    false,
  );
  assert.equal(
    EvidenceArtifactContextSchema.validate({ ...context, pullRequest: null }),
    false,
  );
});

test("uses a host-neutral portable artifact path grammar", () => {
  assert.equal(
    assertSafeRelativePath("supporting/decision.md"),
    "supporting/decision.md",
  );
  assert.equal(portablePathKey("Report.md"), portablePathKey("report.MD"));
  for (const unsafe of [
    "C:/artifact.md",
    "C:artifact.md",
    "//server/share.md",
    "folder\\artifact.md",
    ".manifest.json.kriscard-tmp",
    ".plan.md.KRISCARD-TMP",
    "folder/.evidence.md.kriscard-tmp",
    "CON.md",
    "folder/lpt1.txt",
    "COM¹.txt",
    "LPT².log",
    "résumé.md",
  ]) {
    assert.throws(() => assertSafeRelativePath(unsafe), /Artifact path/);
  }
});

test("rejects portable file-directory and reserved-manifest collisions", async (t) => {
  const temporary = await temporaryTestRoot(t);
  const source = path.join(temporary, "collision-source");
  await mkdir(source);
  await writeFile(path.join(source, "report"), "report\n");
  const context = createContext();
  const verdict = createVerdict();
  verdict.artifactReferences = ["report"];
  const store = createArtifactStore({ root: path.join(temporary, "store") });

  await assert.rejects(
    store.importEvidence({
      context,
      verdict,
      sourceDirectory: source,
      files: ["report", "REPORT/detail.md"],
      createdAt,
    }),
    /collides with another portable path/,
  );
  await assert.rejects(
    store.importEvidence({
      context,
      verdict,
      sourceDirectory: source,
      files: ["MANIFEST.JSON/detail.md"],
      createdAt,
    }),
    /collides with another portable path/,
  );
});

test("canonicalizes configured roots reached through an ancestor symlink", async (t) => {
  const temporary = await temporaryTestRoot(t);
  const actual = path.join(temporary, "actual");
  const alias = path.join(temporary, "alias");
  await mkdir(actual);
  await symlink(actual, alias);

  const store = createArtifactStore({
    root: path.join(alias, "private-store"),
  });
  await store.initialize();

  assert.equal(store.root, path.join(await realpath(actual), "private-store"));
});

test("imports, verifies, exports, and restores an approved revision", async (t) => {
  const temporary = await temporaryTestRoot(t);
  const source = await createApprovedSource(temporary);
  await mkdir(path.join(source, "notes"));
  await writeFile(path.join(source, "notes", "decision.md"), "# Decision\n");
  const context = createContext();
  const revisionId = createId("revision", randomUUID());
  const store = createArtifactStore({ root: path.join(temporary, "store") });

  const imported = await store.importApprovedRevision({
    context,
    revisionId,
    sourceDirectory: source,
    supportingFiles: ["notes/decision.md"],
    migrationId: "revision-import",
    createdAt,
  });
  await assert.rejects(
    store.importApprovedRevision({
      context,
      revisionId: createId("revision", randomUUID()),
      sourceDirectory: imported.directory,
      createdAt,
    }),
    (error) => isArtifactStoreError(error) && error.code === "INVALID_PATH",
  );

  const manifest = await store.verify({
    kind: "revision",
    repositoryFingerprint: context.repositoryFingerprint,
    workItemId: context.workItemId,
    revisionId,
  });

  assert.equal(manifest.kind, "revision");
  assert.equal(manifest.files.length, 4);
  assert.equal((await stat(imported.directory)).mode & 0o777, 0o700);
  assert.equal(
    (await stat(path.join(imported.directory, "spec.md"))).mode & 0o777,
    0o600,
  );

  const exportDirectory = path.join(temporary, "exported-revision");
  const reference: ArtifactReference = {
    kind: "revision",
    repositoryFingerprint: context.repositoryFingerprint,
    workItemId: context.workItemId,
    revisionId,
  };
  await assert.rejects(
    store.export(reference, path.join(imported.directory, "copy")),
    (error) => isArtifactStoreError(error) && error.code === "INVALID_PATH",
  );
  await assert.rejects(
    store.export(reference, temporary),
    (error) => isArtifactStoreError(error) && error.code === "INVALID_PATH",
  );
  await assert.rejects(stat(path.join(imported.directory, "copy")), /ENOENT/);
  await store.export(reference, exportDirectory);
  assert.equal(
    await store.export(reference, exportDirectory),
    await realpath(exportDirectory),
  );

  const sharedExport = path.join(temporary, "shared-export");
  await mkdir(sharedExport, { mode: 0o755 });
  await chmod(sharedExport, 0o755);
  await writeFile(path.join(sharedExport, "unrelated.txt"), "keep me\n");
  await assert.rejects(
    store.export(reference, sharedExport),
    (error) => isArtifactStoreError(error) && error.code === "INVALID_PATH",
  );
  assert.equal((await stat(sharedExport)).mode & 0o777, 0o755);
  assert.equal(
    await readFile(path.join(sharedExport, "unrelated.txt"), "utf8"),
    "keep me\n",
  );

  const partialExport = path.join(temporary, "partial-export");
  await mkdir(partialExport, { mode: 0o700 });
  await writeFile(
    path.join(partialExport, "spec.md"),
    await readFile(path.join(imported.directory, "spec.md")),
    { mode: 0o600 },
  );
  await writeFile(
    path.join(partialExport, ".plan.md.kriscard-tmp"),
    "interrupted write",
    { mode: 0o600 },
  );
  assert.equal(
    await store.export(reference, partialExport),
    await realpath(partialExport),
  );
  await assert.rejects(
    stat(path.join(partialExport, ".plan.md.kriscard-tmp")),
    /ENOENT/,
  );

  const conflictingExport = path.join(temporary, "conflicting-export");
  await mkdir(conflictingExport, { mode: 0o700 });
  await writeFile(path.join(conflictingExport, "spec.md"), "wrong\n", {
    mode: 0o600,
  });
  await assert.rejects(
    store.export(reference, conflictingExport),
    (error) => isArtifactStoreError(error) && error.code === "HASH_MISMATCH",
  );

  const outsideExport = path.join(temporary, "outside-export");
  const nestedSymlinkExport = path.join(temporary, "nested-symlink-export");
  await mkdir(path.join(outsideExport, "notes"), { recursive: true });
  const outsideTemporary = path.join(
    outsideExport,
    "notes",
    ".decision.md.kriscard-tmp",
  );
  await writeFile(outsideTemporary, "must survive\n");
  await mkdir(nestedSymlinkExport, { mode: 0o700 });
  await symlink(outsideExport, path.join(nestedSymlinkExport, "supporting"));
  await assert.rejects(
    store.export(reference, nestedSymlinkExport),
    (error) => isArtifactStoreError(error) && error.code === "SYMLINK_ESCAPE",
  );
  assert.equal(await readFile(outsideTemporary, "utf8"), "must survive\n");

  const restoredRoot = path.join(temporary, "restored-store");
  const restoredStore = createArtifactStore({ root: restoredRoot });
  const restored = await restoredStore.restore(exportDirectory);

  assert.deepEqual(restored.manifest, manifest);
  assert.equal(
    await readFile(path.join(restored.directory, "spec.md"), "utf8"),
    "# Specification\n",
  );
  await assert.rejects(
    restoredStore.retireMigrationSource(restored.migrationId),
    (error) =>
      isArtifactStoreError(error) && error.code === "MIGRATION_CONFLICT",
  );
  assert.equal(
    await readFile(path.join(exportDirectory, "spec.md"), "utf8"),
    "# Specification\n",
  );
  await assert.rejects(
    restoredStore.restore(restored.directory),
    (error) => isArtifactStoreError(error) && error.code === "INVALID_PATH",
  );

  const restoreJournalPath = path.join(
    restoredRoot,
    ".migrations",
    `${restored.migrationId}.json`,
  );
  await writeLegacyJournal(restoreJournalPath);
  const oldRestoreId = `restore-${digest(path.relative(restoredStore.root, restored.directory).split(path.sep).join("/")).slice(0, 24)}`;
  const oldRestoreJournal = MigrationJournalSchema.parse(
    JSON.parse(await readFile(restoreJournalPath, "utf8")),
  );
  oldRestoreJournal.migrationId = oldRestoreId;
  await writeFile(
    path.join(restoredRoot, ".migrations", `${oldRestoreId}.json`),
    `${JSON.stringify(oldRestoreJournal, null, 2)}\n`,
    { mode: 0o600 },
  );
  assert.equal(
    (await restoredStore.resumeMigration(oldRestoreId)).directory,
    restored.directory,
  );
  await assert.rejects(
    restoredStore.retireMigrationSource(oldRestoreId),
    (error) =>
      isArtifactStoreError(error) && error.code === "MIGRATION_CONFLICT",
  );
  assert.equal(
    (await restoredStore.restore(exportDirectory)).directory,
    restored.directory,
  );
  await assert.rejects(
    restoredStore.retireMigrationSource(restored.migrationId),
    (error) =>
      isArtifactStoreError(error) && error.code === "MIGRATION_CONFLICT",
  );
  assert.equal(
    await readFile(path.join(exportDirectory, "spec.md"), "utf8"),
    "# Specification\n",
  );
  const unsafeJournal = MigrationJournalSchema.parse(
    JSON.parse(await readFile(restoreJournalPath, "utf8")),
  );
  unsafeJournal.sourceDirectory = restored.directory;
  unsafeJournal.sourceDisposition = "retire";
  await writeFile(
    restoreJournalPath,
    `${JSON.stringify(unsafeJournal, null, 2)}\n`,
    { mode: 0o600 },
  );
  await assert.rejects(
    restoredStore.retireMigrationSource(restored.migrationId),
    (error) => isArtifactStoreError(error) && error.code === "INVALID_PATH",
  );
  assert.equal(
    await readFile(path.join(restored.directory, "spec.md"), "utf8"),
    "# Specification\n",
  );
});

test("repeating the same import is idempotent", async (t) => {
  const temporary = await temporaryTestRoot(t);
  const source = await createApprovedSource(temporary);
  const context = createContext();
  const revisionId = createId("revision", randomUUID());
  const store = createArtifactStore({ root: path.join(temporary, "store") });
  const request = {
    context,
    revisionId,
    sourceDirectory: source,
    migrationId: "idempotent-import",
  };

  const first = await store.importApprovedRevision(request);
  await writeLegacyJournal(
    path.join(store.root, ".migrations", "idempotent-import.json"),
  );
  const second = await store.importApprovedRevision(request);

  assert.equal(second.directory, first.directory);
  assert.deepEqual(second.manifest, first.manifest);
});

test("legacy import IDs that resemble restores remain retireable", async (t) => {
  const temporary = await temporaryTestRoot(t);
  const sourceDirectory = await createApprovedSource(temporary);
  const store = createArtifactStore({ root: path.join(temporary, "store") });
  const migrationId = `restore-${"a".repeat(24)}`;
  const request = {
    context: createContext(),
    revisionId: createId("revision", randomUUID()),
    sourceDirectory,
    migrationId,
    createdAt,
  };

  const imported = await store.importApprovedRevision(request);
  const reservedId = `restore-${digest(path.relative(store.root, imported.directory).split(path.sep).join("/")).slice(0, 24)}`;
  await assert.rejects(
    store.importApprovedRevision({ ...request, migrationId: reservedId }),
    (error) =>
      isArtifactStoreError(error) && error.code === "MIGRATION_CONFLICT",
  );
  await writeLegacyJournal(
    path.join(store.root, ".migrations", `${migrationId}.json`),
  );
  await store.importApprovedRevision(request);
  await store.retireMigrationSource(migrationId);
  await assert.rejects(readFile(path.join(sourceDirectory, "spec.md")));
});

test("rejects approval hash mismatches", async (t) => {
  const temporary = await temporaryTestRoot(t);
  const source = await createApprovedSource(temporary);
  await writeFile(path.join(source, "spec.md"), "changed after approval\n");
  const store = createArtifactStore({ root: path.join(temporary, "store") });

  await assert.rejects(
    store.importApprovedRevision({
      context: createContext(),
      revisionId: createId("revision", randomUUID()),
      sourceDirectory: source,
      createdAt,
    }),
    (error) => isArtifactStoreError(error) && error.code === "HASH_MISMATCH",
  );
});

test("rejects incomplete, conflicting, or rejected approval lifecycle metadata", async (t) => {
  const temporary = await temporaryTestRoot(t);
  const malformedApprovals = new Map<string, (approval: string) => string>([
    [
      "rejected",
      (approval) => approval.replace("Status: Approved", "Status: Rejected"),
    ],
    [
      "missing method",
      (approval) => approval.replace("Method: Plannotator\n", ""),
    ],
    [
      "missing timestamp",
      (approval) => approval.replace(/^Approved at:.*\n/m, ""),
    ],
    [
      "conflicting status",
      (approval) =>
        approval.replace(
          "Status: Approved\n",
          "Status: Approved\nStatus: Rejected\n",
        ),
    ],
    [
      "missing design decision",
      (approval) => approval.replace(/^.*Technical Design:.*\n/m, ""),
    ],
    [
      "conflicting plan decision",
      (approval) =>
        approval.replace(
          "- Plan: Plannotator returned `approved` for the current `plan.md`.",
          "- Plan: Plannotator decision rejected",
        ),
    ],
    [
      "requirements not approved",
      (approval) =>
        approval.replace(
          "- Requirements: The previously approved Requirements layer is unchanged.",
          "- Requirements: Plannotator decision not approved",
        ),
    ],
    [
      "design approval denied",
      (approval) =>
        approval.replace(
          "- Technical Design: Plannotator returned `approved` for the current `spec.md`.",
          "- Technical Design: Plannotator decision approval denied",
        ),
    ],
    [
      "requirements no approval granted",
      (approval) =>
        approval.replace(
          "- Requirements: The previously approved Requirements layer is unchanged.",
          "- Requirements: No approval was granted",
        ),
    ],
    [
      "plan approval not granted",
      (approval) =>
        approval.replace(
          "- Plan: Plannotator returned `approved` for the current `plan.md`.",
          "- Plan: Approval not granted",
        ),
    ],
    [
      "mixed no approval granted",
      (approval) =>
        approval.replace(
          "- Requirements: The previously approved Requirements layer is unchanged.",
          "- Requirements: Previously approved artifact; no approval was granted for this stage.",
        ),
    ],
    [
      "mixed approval not granted",
      (approval) =>
        approval.replace(
          "- Plan: Plannotator returned `approved` for the current `plan.md`.",
          "- Plan: Previously approved artifact; approval not granted for this stage.",
        ),
    ],
    [
      "missing exceptions",
      (approval) => approval.replace(/\n## Exceptions\n\nNone\.\n$/, "\n"),
    ],
  ]);

  for (const [name, mutate] of malformedApprovals) {
    const fixtureRoot = path.join(temporary, name.replaceAll(" ", "-"));
    const source = await createApprovedSource(fixtureRoot);
    const approvalPath = path.join(source, "approval.md");
    await writeFile(approvalPath, mutate(await readFile(approvalPath, "utf8")));
    const store = createArtifactStore({
      root: path.join(temporary, `store-${name.replaceAll(" ", "-")}`),
    });

    await assert.rejects(
      store.importApprovedRevision({
        context: createContext(),
        revisionId: createId("revision", randomUUID()),
        sourceDirectory: source,
        createdAt,
      }),
      (error) =>
        isArtifactStoreError(error) && error.code === "INVALID_ARTIFACT",
      name,
    );
  }
});

test("rejects traversal and source or destination symlink escapes", async (t) => {
  const temporary = await temporaryTestRoot(t);
  const source = await createApprovedSource(temporary);
  const outside = path.join(temporary, "outside");
  await mkdir(outside);
  await writeFile(path.join(outside, "secret.md"), "secret\n");
  await symlink(
    path.join(outside, "secret.md"),
    path.join(source, "linked.md"),
  );
  const context = createContext();
  const revisionId = createId("revision", randomUUID());
  const storeRoot = path.join(temporary, "store");
  const store = createArtifactStore({ root: storeRoot });

  await assert.rejects(
    store.importApprovedRevision({
      context,
      revisionId,
      sourceDirectory: source,
      supportingFiles: ["../outside/secret.md"],
      createdAt,
    }),
    (error) => isArtifactStoreError(error) && error.code === "INVALID_PATH",
  );
  await assert.rejects(
    store.importApprovedRevision({
      context,
      revisionId,
      sourceDirectory: source,
      supportingFiles: [".spec.md.kriscard-tmp"],
      createdAt,
    }),
    (error) => isArtifactStoreError(error) && error.code === "INVALID_PATH",
  );
  await assert.rejects(
    store.importApprovedRevision({
      context,
      revisionId,
      sourceDirectory: source,
      supportingFiles: ["linked.md"],
      createdAt,
    }),
    (error) => isArtifactStoreError(error) && error.code === "SYMLINK_ESCAPE",
  );

  await store.initialize();
  await symlink(outside, path.join(storeRoot, ".staging", "escape-migration"));
  await assert.rejects(
    store.importApprovedRevision({
      context,
      revisionId,
      sourceDirectory: source,
      migrationId: "escape-migration",
      createdAt,
    }),
    (error) => isArtifactStoreError(error) && error.code === "SYMLINK_ESCAPE",
  );
  assert.equal(
    await readFile(path.join(outside, "secret.md"), "utf8"),
    "secret\n",
  );
});

test("resumes after interruption without replacing copied files", async (t) => {
  const temporary = await temporaryTestRoot(t);
  const source = await createApprovedSource(temporary);
  const context = createContext();
  const revisionId = createId("revision", randomUUID());
  const storeRoot = path.join(temporary, "store");
  let interrupted = false;
  const interruptedStore = createArtifactStore({
    root: storeRoot,
    onCheckpoint(checkpoint) {
      if (!interrupted && checkpoint.phase === "file_copied") {
        interrupted = true;
        throw new Error("simulated interruption");
      }
    },
  });

  await assert.rejects(
    interruptedStore.importApprovedRevision({
      context,
      revisionId,
      sourceDirectory: source,
      migrationId: "restartable-import",
      createdAt,
    }),
    /simulated interruption/,
  );

  const interruptedJournalPath = path.join(
    storeRoot,
    ".migrations",
    "restartable-import.json",
  );
  const oldJournal = MigrationJournalSchema.parse(
    JSON.parse(await readFile(interruptedJournalPath, "utf8")),
  );
  assert.equal(oldJournal.completedFiles, undefined);
  oldJournal.completedFiles = ["spec.md"];
  await writeFile(
    interruptedJournalPath,
    `${JSON.stringify(oldJournal, null, 2)}\n`,
    { mode: 0o600 },
  );
  await writeFile(
    path.join(
      storeRoot,
      ".staging",
      "restartable-import",
      ".plan.md.kriscard-tmp",
    ),
    "interrupted write",
    { mode: 0o600 },
  );
  const resumedStore = createArtifactStore({ root: storeRoot });
  const resumed = await resumedStore.resumeMigration("restartable-import");
  assert.equal(resumed.manifest.kind, "revision");
  assert.equal(
    await readFile(path.join(resumed.directory, "plan.md"), "utf8"),
    "# Plan\n",
  );
  const journal = MigrationJournalSchema.parse(
    JSON.parse(
      await readFile(
        path.join(storeRoot, ".migrations", "restartable-import.json"),
        "utf8",
      ),
    ),
  );
  assert.equal(journal.status, "committed");
});

test("retires legacy sources only after commit and resumes retirement", async (t) => {
  const temporary = await temporaryTestRoot(t);
  const source = await createApprovedSource(temporary);
  await writeFile(path.join(source, "unrelated.txt"), "keep me\n");
  const context = createContext();
  const revisionId = createId("revision", randomUUID());
  let interrupted = false;
  const storeRoot = path.join(temporary, "store");
  const interruptingStore = createArtifactStore({
    root: storeRoot,
    onCheckpoint(checkpoint) {
      if (!interrupted && checkpoint.phase === "source_retired") {
        interrupted = true;
        throw new Error("retirement interrupted");
      }
    },
  });
  await interruptingStore.importApprovedRevision({
    context,
    revisionId,
    sourceDirectory: source,
    migrationId: "retirement-import",
    createdAt,
  });
  await writeLegacyJournal(
    path.join(storeRoot, ".migrations", "retirement-import.json"),
  );

  await assert.rejects(
    interruptingStore.retireMigrationSource("retirement-import"),
    /retirement interrupted/,
  );
  const resumedStore = createArtifactStore({ root: storeRoot });
  const resumed = await resumedStore.resumeMigration("retirement-import");

  assert.equal(resumed.manifest.kind, "revision");
  await assert.rejects(stat(path.join(source, "spec.md")), /ENOENT/);
  await assert.rejects(stat(path.join(source, "plan.md")), /ENOENT/);
  await assert.rejects(stat(path.join(source, "approval.md")), /ENOENT/);
  assert.equal(
    await readFile(path.join(source, "unrelated.txt"), "utf8"),
    "keep me\n",
  );
  const journal = MigrationJournalSchema.parse(
    JSON.parse(
      await readFile(
        path.join(storeRoot, ".migrations", "retirement-import.json"),
        "utf8",
      ),
    ),
  );
  assert.equal(journal.status, "retired");
  assert.equal("completedFiles" in journal, false);
});

test("immutable destinations cannot be replaced by different approved content", async (t) => {
  const temporary = await temporaryTestRoot(t);
  const source = await createApprovedSource(temporary);
  const context = createContext();
  const revisionId = createId("revision", randomUUID());
  const store = createArtifactStore({ root: path.join(temporary, "store") });
  await store.importApprovedRevision({
    context,
    revisionId,
    sourceDirectory: source,
    migrationId: "first-import",
    createdAt,
  });

  const changedSource = await createApprovedSource(
    path.join(temporary, "changed"),
    "# Changed specification\n",
  );
  await assert.rejects(
    store.importApprovedRevision({
      context,
      revisionId,
      sourceDirectory: changedSource,
      migrationId: "second-import",
      createdAt,
    }),
    (error) =>
      isArtifactStoreError(error) && error.code === "IMMUTABLE_CONFLICT",
  );
});

test("a conflicting restore cannot poison a later genuine restore", async (t) => {
  const temporary = await temporaryTestRoot(t);
  const context = createContext();
  const revisionId = createId("revision", randomUUID());
  const genuineSource = await createApprovedSource(
    path.join(temporary, "genuine-source"),
  );
  const destinationStore = createArtifactStore({
    root: path.join(temporary, "destination-store"),
  });
  const reference: ArtifactReference = {
    kind: "revision",
    repositoryFingerprint: context.repositoryFingerprint,
    workItemId: context.workItemId,
    revisionId,
  };
  await destinationStore.importApprovedRevision({
    context,
    revisionId,
    sourceDirectory: genuineSource,
    migrationId: "destination-import",
    createdAt,
  });
  const genuineExport = path.join(temporary, "genuine-export");
  await destinationStore.export(reference, genuineExport);

  const conflictingSource = await createApprovedSource(
    path.join(temporary, "conflicting-source"),
    "# Conflicting specification\n",
  );
  const conflictingStore = createArtifactStore({
    root: path.join(temporary, "conflicting-store"),
  });
  await conflictingStore.importApprovedRevision({
    context,
    revisionId,
    sourceDirectory: conflictingSource,
    createdAt,
  });
  const conflictingExport = path.join(temporary, "conflicting-export");
  await conflictingStore.export(reference, conflictingExport);

  await assert.rejects(
    destinationStore.restore(conflictingExport),
    (error) =>
      isArtifactStoreError(error) && error.code === "IMMUTABLE_CONFLICT",
  );
  const restored = await destinationStore.restore(genuineExport);
  assert.equal(restored.manifest.kind, "revision");
});

test("restore rejects self-consistent manifests with forged relationships", async (t) => {
  const temporary = await temporaryTestRoot(t);
  const context = createContext();
  const revisionId = createId("revision", randomUUID());
  const source = await createApprovedSource(temporary);
  const sourceStore = createArtifactStore({
    root: path.join(temporary, "source-store"),
  });
  await sourceStore.importApprovedRevision({
    context,
    revisionId,
    sourceDirectory: source,
    createdAt,
  });
  const exportDirectory = path.join(temporary, "forged-export");
  await sourceStore.export(
    {
      kind: "revision",
      repositoryFingerprint: context.repositoryFingerprint,
      workItemId: context.workItemId,
      revisionId,
    },
    exportDirectory,
  );
  const manifestPath = path.join(exportDirectory, "manifest.json");
  const forged = ArtifactBundleManifestSchema.parse(
    JSON.parse(await readFile(manifestPath, "utf8")),
  );
  forged.files = forged.files.filter((file) => file.path !== "spec.md");
  await unlink(path.join(exportDirectory, "spec.md"));
  await writeFile(manifestPath, `${JSON.stringify(forged, null, 2)}\n`, {
    mode: 0o600,
  });

  const restoredStore = createArtifactStore({
    root: path.join(temporary, "restored-store"),
  });
  await assert.rejects(
    restoredStore.restore(exportDirectory),
    /requires spec.md, plan.md, and approval.md/,
  );
});

test("stores and verifies readable final evidence", async (t) => {
  const temporary = await temporaryTestRoot(t);
  const source = path.join(temporary, "evidence-source");
  await mkdir(source);
  await writeFile(path.join(source, "evidence.md"), "# Verification\nPassed\n");
  const context = createContext();
  const verdict = createVerdict();
  const store = createArtifactStore({ root: path.join(temporary, "store") });

  const imported = await store.importEvidence({
    context,
    verdict,
    sourceDirectory: source,
    files: ["evidence.md"],
    migrationId: "evidence-import",
    createdAt,
  });
  const verified = await store.verify({
    kind: "evidence",
    repositoryFingerprint: context.repositoryFingerprint,
    workItemId: context.workItemId,
    verdictId: verdict.id,
  });

  assert.equal(verified.kind, "evidence");
  assert.equal(
    await readFile(path.join(imported.directory, "evidence.md"), "utf8"),
    "# Verification\nPassed\n",
  );
});

test("restore rejects forged evidence IDs and missing artifact references", async (t) => {
  const temporary = await temporaryTestRoot(t);
  const source = path.join(temporary, "evidence-source");
  await mkdir(source);
  await writeFile(path.join(source, "evidence.md"), "# Verification\nPassed\n");
  const context = createContext();
  const verdict = createVerdict();
  const sourceStore = createArtifactStore({
    root: path.join(temporary, "source-store"),
  });
  await sourceStore.importEvidence({
    context,
    verdict,
    sourceDirectory: source,
    files: ["evidence.md"],
    createdAt,
  });
  const exportDirectory = path.join(temporary, "evidence-export");
  await sourceStore.export(
    {
      kind: "evidence",
      repositoryFingerprint: context.repositoryFingerprint,
      workItemId: context.workItemId,
      verdictId: verdict.id,
    },
    exportDirectory,
  );
  const manifestPath = path.join(exportDirectory, "manifest.json");
  const forged = ArtifactBundleManifestSchema.parse(
    JSON.parse(await readFile(manifestPath, "utf8")),
  );
  if (forged.kind !== "evidence") throw new Error("Expected evidence bundle");
  forged.verdictId = createId("verdict", randomUUID());
  await writeFile(manifestPath, `${JSON.stringify(forged, null, 2)}\n`, {
    mode: 0o600,
  });
  const restoredStore = createArtifactStore({
    root: path.join(temporary, "restored-store"),
  });
  await assert.rejects(
    restoredStore.restore(exportDirectory),
    /verdictId does not match verdict.id/,
  );

  forged.verdictId = forged.verdict.id;
  forged.verdict.artifactReferences = ["missing.md"];
  await writeFile(manifestPath, `${JSON.stringify(forged, null, 2)}\n`, {
    mode: 0o600,
  });
  await assert.rejects(
    restoredStore.restore(exportDirectory),
    /artifact reference is not stored/,
  );
});

test("verification rejects permission weakening and untracked files", async (t) => {
  const temporary = await temporaryTestRoot(t);
  const source = await createApprovedSource(temporary);
  const context = createContext();
  const revisionId = createId("revision", randomUUID());
  const store = createArtifactStore({ root: path.join(temporary, "store") });
  const imported = await store.importApprovedRevision({
    context,
    revisionId,
    sourceDirectory: source,
    createdAt,
  });
  const reference: ArtifactReference = {
    kind: "revision",
    repositoryFingerprint: context.repositoryFingerprint,
    workItemId: context.workItemId,
    revisionId,
  };

  await chmod(imported.directory, 0o755);
  await assert.rejects(
    store.verify(reference),
    /root permissions are not user-only/,
  );
  await chmod(imported.directory, 0o700);
  await chmod(path.join(imported.directory, "spec.md"), 0o644);
  await assert.rejects(
    store.verify(reference),
    /permissions are not user-only/,
  );
  await chmod(path.join(imported.directory, "spec.md"), 0o600);
  await writeFile(
    path.join(imported.directory, "untracked.md"),
    "unexpected\n",
    {
      mode: 0o600,
    },
  );
  await assert.rejects(store.verify(reference), /missing or untracked files/);
});

function createVerdict(): EvidenceVerdict {
  const categories: EvidenceCategory[] = [
    "repository_checks",
    "product_behavior",
    "requirement_coverage",
    "risk_review",
  ];
  return {
    schemaVersion: 1,
    id: createId("verdict", randomUUID()),
    unitId: createId("unit", randomUUID()),
    requirementIds: ["R4"],
    evidenceIds: ["V3"],
    verifierWorkerId: createId("worker", randomUUID()),
    headSha: "b".repeat(40),
    baseSha: "a".repeat(40),
    categoryResults: categories.map((category) => ({
      category,
      status: "passed",
      receiptIds: [`receipt-${category}`],
    })),
    artifactReferences: ["evidence.md"],
    verdict: "verified",
    createdAt,
  };
}
