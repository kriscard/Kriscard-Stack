import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test, vi } from "vitest";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createId } from "@kriscard/core";

import {
  ControlPlaneApiError,
  createControlPlaneClient,
  startApiServer,
} from "../src/api/index.js";
import { createArtifactStore } from "../src/artifacts/index.js";
import {
  openControlPlane,
  type OpenControlPlane,
} from "../src/runtime/open.js";

const deviceId = "planning-test-device";
const credential = "planning-test-secret-".repeat(3);
const createdAtPattern = /^\d{4}-\d{2}-\d{2}T/;

type Client = ReturnType<typeof createControlPlaneClient>;

function digest(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

async function fixtureRoot(t: {
  onTestFinished: (callback: () => Promise<void>) => void;
}): Promise<{ temporary: string; dataRoot: string; source: string }> {
  const temporary = await mkdtemp(path.join(tmpdir(), "kriscard-planning-"));
  t.onTestFinished(() => rm(temporary, { recursive: true, force: true }));
  const source = path.join(temporary, "source");
  await mkdir(source);
  await writeFile(
    path.join(source, "spec.md"),
    "# Requirements\n\nR1 approved.\n",
  );
  return { temporary, dataRoot: path.join(temporary, "data"), source };
}

function planningIdentity() {
  const workItemId = createId("workItem", randomUUID());
  const revisionId = createId("revision", randomUUID());
  return {
    revisionId,
    context: {
      repositoryFingerprint: "github.com/kriscard/Kriscard-Stack",
      targetBranch: "main",
      startingCommit: "a".repeat(40),
      workItemId,
      taskGroup: "P9",
      branch: "feature/t9-planning",
      pullRequest: null,
      additiveMetadata: { fixture: true },
    },
  };
}

async function openApi(runtime: OpenControlPlane): Promise<{
  server: Awaited<ReturnType<typeof startApiServer>>;
  client: Client;
}> {
  const server = await startApiServer({
    runtime,
    deviceCredentials: { [deviceId]: credential },
  });
  return {
    server,
    client: createControlPlaneClient({ url: server.url, deviceId, credential }),
  };
}

async function currentVersion(client: Client): Promise<number> {
  return (await client.planningState()).version;
}

async function startRun(
  client: Client,
  source: string,
  identity: ReturnType<typeof planningIdentity>,
): Promise<void> {
  await client.submitPlanning({
    key: `start-${identity.revisionId}`,
    operation: "start",
    expectedVersion: await currentVersion(client),
    revisionId: identity.revisionId,
    context: identity.context,
    sourceDirectory: source,
  });
}

async function approveStage(
  client: Client,
  source: string,
  revisionId: ReturnType<typeof planningIdentity>["revisionId"],
  stage: "requirements" | "design" | "plan",
  sequence: string,
): Promise<string> {
  const fileName = stage === "plan" ? "plan.md" : "spec.md";
  const sha256 = digest(await readFile(path.join(source, fileName)));
  const reviewReference = `review-${stage}-${sequence}`;
  await client.submitPlanning({
    key: `open-${stage}-${sequence}`,
    operation: "open_gate",
    expectedVersion: await currentVersion(client),
    revisionId,
    stage,
    reviewReference,
  });
  await client.submitPlanning({
    key: `approve-${stage}-${sequence}`,
    operation: "approve_gate",
    expectedVersion: await currentVersion(client),
    revisionId,
    stage,
    reviewReference,
    expectedSha256: sha256,
  });
  return sha256;
}

async function completeStages(
  client: Client,
  source: string,
  identity: ReturnType<typeof planningIdentity>,
): Promise<{ specHash: string; planHash: string }> {
  await startRun(client, source, identity);
  await approveStage(
    client,
    source,
    identity.revisionId,
    "requirements",
    "one",
  );
  await writeFile(
    path.join(source, "spec.md"),
    "# Requirements\n\nR1 approved.\n\n# Technical Design\n\nD1 approved.\n",
  );
  const specHash = await approveStage(
    client,
    source,
    identity.revisionId,
    "design",
    "one",
  );
  await writeFile(
    path.join(source, "plan.md"),
    "# Plan\n\nT1 implements R1 through D1.\n\nValidation: V1.\n",
  );
  const planHash = await approveStage(
    client,
    source,
    identity.revisionId,
    "plan",
    "one",
  );
  return { specHash, planHash };
}

async function writeApproval(
  source: string,
  hashes: { specHash: string; planHash: string },
): Promise<void> {
  await writeFile(
    path.join(source, "approval.md"),
    `# Approval\n\nStatus: Approved\nMethod: Plannotator\n\n## Approved artifacts\n\n- \`spec.md\`\n  - SHA-256: \`${hashes.specHash}\`\n- \`plan.md\`\n  - SHA-256: \`${hashes.planHash}\`\n`,
  );
}

async function waitForRun(
  client: Client,
  revisionId: string,
  status: "blocked" | "approved",
) {
  return vi.waitUntil(
    async () => {
      const run = await client.planningRun(revisionId);
      if (status === "approved" && run.status === "blocked")
        throw new Error(
          `Planning finalization blocked: ${run.error?.code}: ${run.error?.message}`,
        );
      return run.status === status ? run : false;
    },
    { timeout: 5_000, interval: 10 },
  );
}

test("planning API enforces Requirements, Design, Plan, and immutable approval in order", async (t) => {
  const { dataRoot, source } = await fixtureRoot(t);
  const identity = planningIdentity();
  const runtime = await openControlPlane(dataRoot);
  const { server, client } = await openApi(runtime);
  t.onTestFinished(async () => {
    await server.close();
    await runtime.close();
  });

  await startRun(client, source, identity);
  const duplicate = await client.submitPlanning({
    key: `start-${identity.revisionId}`,
    operation: "start",
    expectedVersion: 0,
    revisionId: identity.revisionId,
    context: identity.context,
    sourceDirectory: source,
  });
  assert.equal(duplicate.version, 1);
  assert.deepEqual(
    (await client.planningRun(identity.revisionId)).context.additiveMetadata,
    { fixture: true },
  );
  await assert.rejects(
    client.submitPlanning({
      key: `start-${identity.revisionId}`,
      operation: "start",
      expectedVersion: 0,
      revisionId: identity.revisionId,
      context: identity.context,
      sourceDirectory: `${source}-different`,
    }),
    (error) =>
      error instanceof ControlPlaneApiError && error.code === "KEY_CONFLICT",
  );
  await assert.rejects(
    client.submitPlanning({
      key: "stale-planning-command",
      operation: "open_gate",
      expectedVersion: 0,
      revisionId: identity.revisionId,
      stage: "requirements",
      reviewReference: "review-stale-version",
    }),
    (error) =>
      error instanceof ControlPlaneApiError && error.code === "STALE_VERSION",
  );
  await assert.rejects(
    client.submitPlanning({
      key: "skip-requirements",
      operation: "open_gate",
      expectedVersion: await currentVersion(client),
      revisionId: identity.revisionId,
      stage: "design",
      reviewReference: "review-design-too-early",
    }),
    (error) =>
      error instanceof ControlPlaneApiError && error.code === "STAGE_ORDER",
  );

  await approveStage(
    client,
    source,
    identity.revisionId,
    "requirements",
    "ordered",
  );
  await writeFile(
    path.join(source, "spec.md"),
    "# Requirements\n\nR1 approved.\n\n# Technical Design\n\nD1 approved.\n",
  );
  const specHash = await approveStage(
    client,
    source,
    identity.revisionId,
    "design",
    "ordered",
  );
  await writeFile(path.join(source, "plan.md"), "# Plan\n\nT1 / V1\n");
  const planHash = await approveStage(
    client,
    source,
    identity.revisionId,
    "plan",
    "ordered",
  );
  await writeApproval(source, { specHash, planHash });

  const otherClient = createControlPlaneClient({
    url: server.url,
    deviceId,
    credential,
  });
  assert.equal(
    (await otherClient.planningRun(identity.revisionId)).currentStage,
    "approval",
  );
  const eventStream = otherClient.planningEvents(0);
  const firstEvent = await eventStream.next();
  assert.equal(firstEvent.value?.run.currentStage, "requirements");
  await eventStream.return(undefined);

  await client.submitPlanning({
    key: "finalize-ordered",
    operation: "finalize",
    expectedVersion: await currentVersion(client),
    revisionId: identity.revisionId,
  });
  const approved = await waitForRun(client, identity.revisionId, "approved");
  assert.equal(approved.currentStage, "complete");
  assert.equal(approved.artifact?.approvedHashes.spec, specHash);
  assert.equal(approved.artifact?.approvedHashes.plan, planHash);
  assert.match(
    approved.gates.requirements.receipt?.approvedAt ?? "",
    createdAtPattern,
  );

  const manifest = await createArtifactStore({ root: dataRoot }).verify({
    kind: "revision",
    repositoryFingerprint: identity.context.repositoryFingerprint,
    workItemId: identity.context.workItemId,
    revisionId: identity.revisionId,
  });
  assert.equal(manifest.kind, "revision");
  assert.equal(manifest.approvedHashes.spec, specHash);
});

test("planning revisions invalidate only the approved stage and its downstream gates", async (t) => {
  const { dataRoot, source } = await fixtureRoot(t);
  const identity = planningIdentity();
  const runtime = await openControlPlane(dataRoot);
  const { server, client } = await openApi(runtime);
  t.onTestFinished(async () => {
    await server.close();
    await runtime.close();
  });
  await completeStages(client, source, identity);

  await client.submitPlanning({
    key: "revise-plan",
    operation: "revise",
    expectedVersion: await currentVersion(client),
    revisionId: identity.revisionId,
    stage: "plan",
  });
  let run = await client.planningRun(identity.revisionId);
  assert.equal(run.gates.requirements.status, "approved");
  assert.equal(run.gates.design.status, "approved");
  assert.equal(run.gates.plan.status, "awaiting_review");
  assert.equal(run.currentStage, "plan");

  await approveStage(client, source, identity.revisionId, "plan", "revised");
  await client.submitPlanning({
    key: "revise-design",
    operation: "revise",
    expectedVersion: await currentVersion(client),
    revisionId: identity.revisionId,
    stage: "design",
  });
  run = await client.planningRun(identity.revisionId);
  assert.equal(run.gates.requirements.status, "approved");
  assert.equal(run.gates.design.status, "awaiting_review");
  assert.equal(run.gates.plan.status, "awaiting_review");

  await client.submitPlanning({
    key: "revise-requirements",
    operation: "revise",
    expectedVersion: await currentVersion(client),
    revisionId: identity.revisionId,
    stage: "requirements",
  });
  run = await client.planningRun(identity.revisionId);
  assert.equal(run.currentStage, "requirements");
  assert.deepEqual(
    Object.values(run.gates).map((gate) => gate.status),
    ["awaiting_review", "awaiting_review", "awaiting_review"],
  );
});

for (const changedFile of ["spec.md", "plan.md"] as const) {
  test(`finalization rejects ${changedFile} changed after approval without marking the run approved`, async (t) => {
    const { dataRoot, source } = await fixtureRoot(t);
    const identity = planningIdentity();
    const runtime = await openControlPlane(dataRoot);
    const { server, client } = await openApi(runtime);
    t.onTestFinished(async () => {
      await server.close();
      await runtime.close();
    });
    const hashes = await completeStages(client, source, identity);
    await writeApproval(source, hashes);
    await writeFile(path.join(source, changedFile), "changed after approval\n");

    await client.submitPlanning({
      key: `bad-hash-${changedFile}`,
      operation: "finalize",
      expectedVersion: await currentVersion(client),
      revisionId: identity.revisionId,
    });
    const blocked = await waitForRun(client, identity.revisionId, "blocked");
    assert.equal(blocked.currentStage, "approval");
    assert.equal(blocked.error?.code, "HASH_MISMATCH", blocked.error?.message);
    assert.equal(blocked.artifact, null);
  });
}

test("restart preserves receipts, reconciles an interrupted review, and resumes one migration identity", async (t) => {
  const { dataRoot, source } = await fixtureRoot(t);
  const identity = planningIdentity();
  let interrupted = false;
  const interruptingStore = createArtifactStore({
    root: dataRoot,
    onCheckpoint(checkpoint) {
      if (!interrupted && checkpoint.phase === "file_copied") {
        interrupted = true;
        throw new Error("simulated artifact checkpoint interruption");
      }
    },
  });

  let runtime = await openControlPlane(
    dataRoot,
    BACKGROUND_CONTEXT,
    undefined,
    {
      artifactStore: interruptingStore,
    },
  );
  let api = await openApi(runtime);
  t.onTestFinished(async () => {
    await api.server.close();
    await runtime.close();
  });
  await startRun(api.client, source, identity);
  await api.client.submitPlanning({
    key: "open-before-restart",
    operation: "open_gate",
    expectedVersion: await currentVersion(api.client),
    revisionId: identity.revisionId,
    stage: "requirements",
    reviewReference: "review-before-restart",
  });
  await api.server.close();
  await runtime.close();

  runtime = await openControlPlane(dataRoot, BACKGROUND_CONTEXT, undefined, {
    artifactStore: interruptingStore,
  });
  api = await openApi(runtime);
  let recovered = await api.client.planningRun(identity.revisionId);
  assert.equal(recovered.gates.requirements.status, "needs_reconciliation");
  const requirementsHash = digest(await readFile(path.join(source, "spec.md")));
  await api.client.submitPlanning({
    key: "approve-reconciled-review",
    operation: "approve_gate",
    expectedVersion: await currentVersion(api.client),
    revisionId: identity.revisionId,
    stage: "requirements",
    reviewReference: "review-before-restart",
    expectedSha256: requirementsHash,
  });
  await writeFile(
    path.join(source, "spec.md"),
    "# Requirements\n\nR1 approved.\n\n# Technical Design\n\nD1 approved.\n",
  );
  const specHash = await approveStage(
    api.client,
    source,
    identity.revisionId,
    "design",
    "restart",
  );
  await writeFile(path.join(source, "plan.md"), "# Plan\n\nT1 / V1\n");
  const planHash = await approveStage(
    api.client,
    source,
    identity.revisionId,
    "plan",
    "restart",
  );
  await writeApproval(source, { specHash, planHash });

  await api.server.close();
  await runtime.close();
  runtime = await openControlPlane(dataRoot, BACKGROUND_CONTEXT, undefined, {
    artifactStore: interruptingStore,
  });
  api = await openApi(runtime);
  recovered = await api.client.planningRun(identity.revisionId);
  assert.equal(recovered.gates.requirements.receipt?.sha256, requirementsHash);
  assert.equal(recovered.gates.design.receipt?.sha256, specHash);
  assert.equal(recovered.gates.plan.receipt?.sha256, planHash);

  await api.client.submitPlanning({
    key: "finalize-interrupted-checkpoint",
    operation: "finalize",
    expectedVersion: await currentVersion(api.client),
    revisionId: identity.revisionId,
  });
  const blocked = await waitForRun(api.client, identity.revisionId, "blocked");
  assert.equal(blocked.error?.code, "FINALIZATION_FAILED");
  const migrationId = blocked.migrationId;
  await api.server.close();
  await runtime.close();

  runtime = await openControlPlane(dataRoot);
  api = await openApi(runtime);
  await api.client.submitPlanning({
    key: "finalize-resumed-checkpoint",
    operation: "finalize",
    expectedVersion: await currentVersion(api.client),
    revisionId: identity.revisionId,
  });
  const approved = await waitForRun(
    api.client,
    identity.revisionId,
    "approved",
  );
  assert.equal(approved.artifact?.migrationId, migrationId);

  await api.server.close();
  await runtime.close();
});
