import assert from "node:assert/strict";
import test from "node:test";

import {
  CoreRecordJsonSchemas,
  CoreRecordSchemas,
  createId as createCoreId,
  decodeRecord,
  EvidenceVerdictSchema,
  ProjectIdSchema,
  ProjectSchema,
  StateTransitionSchema,
  TimestampSchema,
  WorkItemSchema,
} from "../src/index.js";
import { createId } from "./helpers.js";

test("createId validates a caller-provided UUID", () => {
  const id = createCoreId("project", "00000000-0000-4000-8000-000000000001");

  assert.match(id, /^prj_/);
  assert.equal(ProjectIdSchema.validate(id), true);
  assert.equal(ProjectIdSchema.validate(createId("unit")), false);
  assert.throws(() => createCoreId("project", "not-a-uuid"));
});

test("decodeRecord rejects invalid records with bounded field errors", () => {
  assert.throws(
    () => decodeRecord(ProjectSchema, { schemaVersion: 1 }),
    (error) =>
      error instanceof Error &&
      error.message.startsWith("/id:") &&
      error.message.split("; ").length === 3,
  );
});

test("decodeRecord retains unknown additive fields", () => {
  const raw: unknown = {
    schemaVersion: 1,
    id: createId("project"),
    repositoryFingerprint: "github.com/kriscard/example",
    canonicalRemote: "https://github.com/kriscard/example.git",
    localPaths: ["/tmp/example"],
    defaultBranch: "main",
    forge: "github",
    requiredCapabilities: ["git"],
    futureField: { retained: true },
  };

  const serialized: unknown = JSON.parse(JSON.stringify(raw));
  const decoded = decodeRecord(ProjectSchema, serialized);

  assert.deepEqual(decoded.futureField, { retained: true });
});

test("nested additive fields survive repeated record decoding", () => {
  const raw: unknown = {
    schemaVersion: 1,
    id: createId("workItem"),
    type: "feature",
    source: { kind: "user", futureSourceField: "keep" },
    projectId: createId("project"),
    childWorkItemIds: [],
    state: "discovered",
    initiatingHost: "pi",
    policy: {},
    futureRecordField: { keep: true },
  };

  const firstDecode = decodeRecord(WorkItemSchema, raw);
  const serialized: unknown = JSON.parse(JSON.stringify(firstDecode));
  const secondDecode = decodeRecord(WorkItemSchema, serialized);

  assert.equal(secondDecode.source.futureSourceField, "keep");
  assert.deepEqual(secondDecode.futureRecordField, { keep: true });
});

test("evidence records require the verified base SHA specifically", () => {
  assert.throws(
    () =>
      decodeRecord(EvidenceVerdictSchema, {
        schemaVersion: 1,
        id: createId("verdict"),
        unitId: createId("unit"),
        requirementIds: ["R1"],
        evidenceIds: ["V1"],
        verifierWorkerId: createId("worker"),
        headSha: "a".repeat(40),
        categoryResults: [
          {
            category: "repository_checks",
            status: "passed",
            receiptIds: ["receipt-1"],
          },
        ],
        artifactReferences: [],
        verdict: "verified",
        createdAt: "2026-10-08T00:00:00Z",
      }),
    /\/baseSha:/,
  );
});

test("transition schemas keep subject IDs and states in the same domain", () => {
  const common = {
    schemaVersion: 1,
    actor: "human",
    reason: "Approved",
    occurredAt: "2026-10-08T00:00:00Z",
    idempotencyKey: "approval-1",
  } as const;

  assert.equal(
    StateTransitionSchema.validate({
      ...common,
      subject: "work_item",
      subjectId: createId("workItem"),
      priorState: "plan_review",
      nextState: "approved",
    }),
    true,
  );
  assert.equal(
    StateTransitionSchema.validate({
      ...common,
      subject: "work_item",
      subjectId: createId("unit"),
      priorState: "planned",
      nextState: "ready",
    }),
    false,
  );
});

test("timestamp validation accepts canonical UTC instants only", () => {
  assert.equal(TimestampSchema.validate("2026-10-08T00:00:00Z"), true);
  assert.equal(TimestampSchema.validate("2026-10-08"), false);
  assert.equal(TimestampSchema.validate("2026-10-08T01:00:00+01:00"), false);
  assert.equal(TimestampSchema.validate("2026-02-30T00:00:00Z"), false);
});

test("JSON Schema projections preserve loose objects and discriminated unions", () => {
  assert.notEqual(CoreRecordJsonSchemas.project.additionalProperties, false);
  assert.ok("oneOf" in CoreRecordJsonSchemas.stateTransition);
  assert.equal(
    JSON.stringify(CoreRecordJsonSchemas).includes("transform"),
    false,
  );
  assert.equal(
    CoreRecordJsonSchemas.executionUnit.required?.includes("revisionId"),
    true,
  );
  const workItemProperties = CoreRecordJsonSchemas.workItem.properties;
  assert.ok(workItemProperties && "executionUnitIds" in workItemProperties);
});

test("runtime and JSON Schema both require unique task IDs", () => {
  const executionUnit = {
    schemaVersion: 1,
    id: createId("unit"),
    workItemId: createId("workItem"),
    revisionId: createId("revision"),
    taskIds: ["T1", "T1"],
    goal: "One goal",
    state: "planned",
    dependencies: [],
    conflictKeys: [],
    expectedChangedAreas: ["packages/core"],
    pullRequestGroup: "P1",
    requiredCapabilities: ["git"],
    expectedEvidenceIds: ["V1"],
  };

  assert.equal(CoreRecordSchemas.executionUnit.validate(executionUnit), false);
  const taskIdsSchema = CoreRecordJsonSchemas.executionUnit.properties?.taskIds;
  assert.ok(
    taskIdsSchema &&
      typeof taskIdsSchema === "object" &&
      "uniqueItems" in taskIdsSchema,
  );
  assert.equal(taskIdsSchema.uniqueItems, true);
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
      executionUnitIds: [unitId],
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
      revisionId,
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
      baseSha: sha,
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

  const cases = [
    [
      "stateTransition",
      CoreRecordSchemas.stateTransition,
      fixtures.stateTransition,
    ],
    ["project", CoreRecordSchemas.project, fixtures.project],
    ["workItem", CoreRecordSchemas.workItem, fixtures.workItem],
    [
      "artifactRevision",
      CoreRecordSchemas.artifactRevision,
      fixtures.artifactRevision,
    ],
    ["executionUnit", CoreRecordSchemas.executionUnit, fixtures.executionUnit],
    ["attempt", CoreRecordSchemas.attempt, fixtures.attempt],
    ["pullRequest", CoreRecordSchemas.pullRequest, fixtures.pullRequest],
    [
      "evidenceVerdict",
      CoreRecordSchemas.evidenceVerdict,
      fixtures.evidenceVerdict,
    ],
    ["humanGate", CoreRecordSchemas.humanGate, fixtures.humanGate],
    [
      "principleCandidate",
      CoreRecordSchemas.principleCandidate,
      fixtures.principleCandidate,
    ],
    ["machine", CoreRecordSchemas.machine, fixtures.machine],
  ] as const;

  for (const [name, schema, fixture] of cases) {
    assert.equal(schema.validate(fixture), true, name);
  }
});
