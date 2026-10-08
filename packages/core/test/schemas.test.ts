import assert from "node:assert/strict";
import test from "node:test";
import { Value } from "@sinclair/typebox/value";

import {
  CoreRecordSchemas,
  createId,
  decodeRecord,
  ProjectIdSchema,
  ProjectSchema,
} from "../src/index.js";

test("createId returns an opaque ID accepted by its schema", () => {
  const id = createId("project");

  assert.match(id, /^prj_/);
  assert.equal(Value.Check(ProjectIdSchema, id), true);
  assert.equal(Value.Check(ProjectIdSchema, createId("unit")), false);
});

test("decodeRecord rejects invalid records", () => {
  assert.throws(
    () => decodeRecord(ProjectSchema, { schemaVersion: 1 }),
    /Expected required property/,
  );
});

test("decodeRecord retains unknown additive fields", () => {
  const raw = {
    schemaVersion: 1 as const,
    id: createId("project"),
    repositoryFingerprint: "github.com/kriscard/example",
    canonicalRemote: "https://github.com/kriscard/example.git",
    localPaths: ["/tmp/example"],
    defaultBranch: "main",
    forge: "github" as const,
    requiredCapabilities: ["git" as const],
    futureField: { retained: true },
  };

  const decoded = decodeRecord(
    ProjectSchema,
    JSON.parse(JSON.stringify(raw)) as unknown,
  );

  assert.deepEqual(
    (decoded as typeof decoded & { futureField: unknown }).futureField,
    { retained: true },
  );
});

test("every core record schema accepts a representative record", () => {
  const now = "2026-10-08T00:00:00Z";
  const projectId = createId("project");
  const workItemId = createId("workItem");
  const revisionId = createId("revision");
  const unitId = createId("unit");
  const workerId = createId("worker");
  const machineId = createId("machine");
  const sha = "a".repeat(40);
  const hash = "b".repeat(64);

  const fixtures: Record<keyof typeof CoreRecordSchemas, unknown> = {
    stateTransition: {
      schemaVersion: 1,
      subject: "work_item",
      subjectId: workItemId,
      actor: "human",
      priorState: "plan_review",
      nextState: "approved",
      reason: "Plan approved",
      occurredAt: now,
      idempotencyKey: "approve-plan",
    },
    project: {
      schemaVersion: 1,
      id: projectId,
      repositoryFingerprint: "github.com/kriscard/example",
      canonicalRemote: "https://github.com/kriscard/example.git",
      localPaths: ["/tmp/example"],
      defaultBranch: "main",
      forge: "github",
      requiredCapabilities: ["git", "github"],
    },
    workItem: {
      schemaVersion: 1,
      id: workItemId,
      type: "feature",
      source: { kind: "user" },
      projectId,
      childWorkItemIds: [],
      state: "approved",
      activeRevisionId: revisionId,
      initiatingHost: "pi",
      policy: { budget: "default" },
    },
    artifactRevision: {
      schemaVersion: 1,
      id: revisionId,
      workItemId,
      paths: {
        spec: "spec.md",
        plan: "plan.md",
        approval: "approval.md",
        supporting: [],
      },
      hashes: { spec: hash, plan: hash, approval: hash },
      approvals: [
        {
          stage: "plan",
          decision: "approved",
          method: "Plannotator",
          approvedAt: now,
        },
      ],
      createdBy: "human",
      createdAt: now,
    },
    executionUnit: {
      schemaVersion: 1,
      id: unitId,
      workItemId,
      taskIds: ["T1"],
      goal: "Deliver one goal",
      state: "planned",
      dependencies: [],
      conflictKeys: [],
      expectedChangedAreas: ["packages/core"],
      pullRequestGroup: "P1",
      requiredCapabilities: ["git"],
      expectedEvidenceIds: ["V1"],
    },
    attempt: {
      schemaVersion: 1,
      id: createId("attempt"),
      unitId,
      host: "pi",
      workerId,
      hostSessionId: "session-1",
      machineId,
      worktreePath: "/tmp/example",
      leaseExpiresAt: now,
      startedAt: now,
      replayClass: "reconcile_before_retry",
      usage: { tokens: 100 },
      outputReferences: ["receipt-1"],
      interruptionSafety: "Inspect before retry",
    },
    pullRequest: {
      schemaVersion: 1,
      unitId,
      forge: "github",
      repository: "kriscard/example",
      number: 1,
      branch: "feat/example",
      baseBranch: "main",
      headSha: sha,
      baseSha: sha,
      stackPosition: 0,
      observedStatus: "open",
    },
    evidenceVerdict: {
      schemaVersion: 1,
      id: createId("verdict"),
      unitId,
      requirementIds: ["R1"],
      evidenceIds: ["V1"],
      verifierWorkerId: workerId,
      headSha: sha,
      categoryResults: [
        {
          category: "repository_checks",
          status: "passed",
          receiptIds: ["receipt-1"],
        },
      ],
      artifactReferences: ["evidence.md"],
      verdict: "verified",
      createdAt: now,
    },
    humanGate: {
      schemaVersion: 1,
      id: createId("gate"),
      workItemId,
      unitId,
      question: "Accept this work?",
      reason: "Verification passed",
      allowedDecisions: ["accept", "reject"],
      blockingScope: "unit",
      createdBy: "control_plane",
      createdAt: now,
    },
    principleCandidate: {
      schemaVersion: 1,
      workItemId,
      proposedSkillName: "principle-example",
      citedSources: [{ path: "note.md", excerptHash: hash }],
      draftArtifactPath: "candidate.md",
      evaluationStatus: "pending",
      userDecision: "pending",
    },
    machine: {
      schemaVersion: 1,
      id: machineId,
      label: "Local Mac",
      capabilities: ["git", "pi"],
      capacity: 2,
      lastSeenAt: now,
    },
  };

  for (const [name, schema] of Object.entries(CoreRecordSchemas)) {
    assert.equal(
      Value.Check(schema, fixtures[name as keyof typeof fixtures]),
      true,
      name,
    );
  }
});
