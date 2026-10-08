import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";

import {
  createId,
  type EvidenceCategory,
  type EvidenceVerdict,
} from "@kriscard/core";

import {
  ArtifactStore,
  ArtifactStoreError,
  defaultArtifactRoot,
  type ArtifactContext,
} from "../src/artifacts/index.js";

const createdAt = "2026-10-08T00:00:00Z";

function digest(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function createContext(): ArtifactContext {
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
  const approval = `# Approval\n\n- \`spec.md\`\n  - SHA-256: \`${digest(spec)}\`\n- \`plan.md\`\n  - SHA-256: \`${digest(plan)}\`\n`;
  await writeFile(path.join(source, "spec.md"), spec);
  await writeFile(path.join(source, "plan.md"), plan);
  await writeFile(path.join(source, "approval.md"), approval);
  return source;
}

async function temporaryTestRoot(t: TestContext): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "kriscard-artifacts-"));
  t.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

test("creates a missing private data hierarchy and rejects relative XDG paths", async (t) => {
  const temporary = await temporaryTestRoot(t);
  const root = path.join(temporary, "missing", "data", "kriscard-stack");
  const store = new ArtifactStore({ root });

  await store.initialize();

  assert.equal((await stat(root)).mode & 0o777, 0o700);
  assert.throws(
    () => defaultArtifactRoot({ XDG_DATA_HOME: "relative/data" }, temporary),
    /XDG_DATA_HOME must be an absolute path/,
  );
});

test("imports, verifies, exports, and restores an approved revision", async (t) => {
  const temporary = await temporaryTestRoot(t);
  const source = await createApprovedSource(temporary);
  await mkdir(path.join(source, "notes"));
  await writeFile(path.join(source, "notes", "decision.md"), "# Decision\n");
  const context = createContext();
  const revisionId = createId("revision", randomUUID());
  const store = new ArtifactStore({ root: path.join(temporary, "store") });

  const imported = await store.importApprovedRevision({
    context,
    revisionId,
    sourceDirectory: source,
    supportingFiles: ["notes/decision.md"],
    migrationId: "revision-import",
    createdAt,
  });
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
  await store.export(
    {
      kind: "revision",
      repositoryFingerprint: context.repositoryFingerprint,
      workItemId: context.workItemId,
      revisionId,
    },
    exportDirectory,
  );
  const restoredStore = new ArtifactStore({
    root: path.join(temporary, "restored-store"),
  });
  const restored = await restoredStore.restore(exportDirectory);

  assert.deepEqual(restored.manifest, manifest);
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
  const store = new ArtifactStore({ root: path.join(temporary, "store") });
  const request = {
    context,
    revisionId,
    sourceDirectory: source,
    migrationId: "idempotent-import",
  };

  const first = await store.importApprovedRevision(request);
  const second = await store.importApprovedRevision(request);

  assert.equal(second.directory, first.directory);
  assert.deepEqual(second.manifest, first.manifest);
});

test("rejects approval hash mismatches", async (t) => {
  const temporary = await temporaryTestRoot(t);
  const source = await createApprovedSource(temporary);
  await writeFile(path.join(source, "spec.md"), "changed after approval\n");
  const store = new ArtifactStore({ root: path.join(temporary, "store") });

  await assert.rejects(
    store.importApprovedRevision({
      context: createContext(),
      revisionId: createId("revision", randomUUID()),
      sourceDirectory: source,
      createdAt,
    }),
    (error) =>
      error instanceof ArtifactStoreError && error.code === "HASH_MISMATCH",
  );
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
  const store = new ArtifactStore({ root: storeRoot });

  await assert.rejects(
    store.importApprovedRevision({
      context,
      revisionId,
      sourceDirectory: source,
      supportingFiles: ["../outside/secret.md"],
      createdAt,
    }),
    (error) =>
      error instanceof ArtifactStoreError && error.code === "INVALID_PATH",
  );
  await assert.rejects(
    store.importApprovedRevision({
      context,
      revisionId,
      sourceDirectory: source,
      supportingFiles: ["linked.md"],
      createdAt,
    }),
    (error) =>
      error instanceof ArtifactStoreError && error.code === "SYMLINK_ESCAPE",
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
    (error) =>
      error instanceof ArtifactStoreError && error.code === "SYMLINK_ESCAPE",
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
  const interruptedStore = new ArtifactStore({
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

  const resumedStore = new ArtifactStore({ root: storeRoot });
  const resumed = await resumedStore.resumeMigration("restartable-import");
  assert.equal(resumed.manifest.kind, "revision");
  assert.equal(
    await readFile(path.join(resumed.directory, "plan.md"), "utf8"),
    "# Plan\n",
  );
  const journal = JSON.parse(
    await readFile(
      path.join(storeRoot, ".migrations", "restartable-import.json"),
      "utf8",
    ),
  ) as { status: string };
  assert.equal(journal.status, "committed");
});

test("immutable destinations cannot be replaced by different approved content", async (t) => {
  const temporary = await temporaryTestRoot(t);
  const source = await createApprovedSource(temporary);
  const context = createContext();
  const revisionId = createId("revision", randomUUID());
  const store = new ArtifactStore({ root: path.join(temporary, "store") });
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
      error instanceof ArtifactStoreError &&
      error.code === "IMMUTABLE_CONFLICT",
  );
});

test("stores and verifies readable final evidence", async (t) => {
  const temporary = await temporaryTestRoot(t);
  const source = path.join(temporary, "evidence-source");
  await mkdir(source);
  await writeFile(path.join(source, "evidence.md"), "# Verification\nPassed\n");
  const context = createContext();
  const verdict = createVerdict();
  const store = new ArtifactStore({ root: path.join(temporary, "store") });

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

test("verification rejects permission weakening and untracked files", async (t) => {
  const temporary = await temporaryTestRoot(t);
  const source = await createApprovedSource(temporary);
  const context = createContext();
  const revisionId = createId("revision", randomUUID());
  const store = new ArtifactStore({ root: path.join(temporary, "store") });
  const imported = await store.importApprovedRevision({
    context,
    revisionId,
    sourceDirectory: source,
    createdAt,
  });
  const reference = {
    kind: "revision" as const,
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
