import { randomUUID } from "node:crypto";

import {
  createId as createCoreId,
  type AttemptId,
  type EvidenceCategory,
  type EvidenceContext,
  type ExecutionUnit,
  type ExecutionUnitState,
  type GateId,
  type IdKind,
  type MachineId,
  type ProjectId,
  type RevisionId,
  type UnitId,
  type VerdictId,
  type WorkerId,
  type WorkItem,
  type WorkItemId,
  type WorkItemState,
} from "../src/index.js";

export function createId(kind: "project"): ProjectId;
export function createId(kind: "workItem"): WorkItemId;
export function createId(kind: "revision"): RevisionId;
export function createId(kind: "unit"): UnitId;
export function createId(kind: "attempt"): AttemptId;
export function createId(kind: "worker"): WorkerId;
export function createId(kind: "machine"): MachineId;
export function createId(kind: "gate"): GateId;
export function createId(kind: "verdict"): VerdictId;
export function createId(kind: IdKind) {
  const uuid = randomUUID();

  switch (kind) {
    case "project":
      return createCoreId("project", uuid);
    case "workItem":
      return createCoreId("workItem", uuid);
    case "revision":
      return createCoreId("revision", uuid);
    case "unit":
      return createCoreId("unit", uuid);
    case "attempt":
      return createCoreId("attempt", uuid);
    case "worker":
      return createCoreId("worker", uuid);
    case "machine":
      return createCoreId("machine", uuid);
    case "gate":
      return createCoreId("gate", uuid);
    case "verdict":
      return createCoreId("verdict", uuid);
  }
}

export function createTestWorkItem(
  state: WorkItemState = "verifying",
  pausedFrom?: WorkItemState,
): WorkItem {
  const workItem: WorkItem = {
    schemaVersion: 1,
    id: createId("workItem"),
    type: "feature",
    source: { kind: "test" },
    projectId: createId("project"),
    childWorkItemIds: [],
    state,
    activeRevisionId: createId("revision"),
    executionUnitIds: [],
    initiatingHost: "pi",
    policy: {},
  };
  if (pausedFrom) workItem.pausedFrom = pausedFrom;
  return workItem;
}

export function createTestUnit(
  workItem: WorkItem,
  state: ExecutionUnitState = "verifying",
  expectedEvidenceIds: `V${number}`[] = ["V1"],
): ExecutionUnit {
  if (!workItem.activeRevisionId) {
    throw new Error("Test work item requires an active revision");
  }
  const unit: ExecutionUnit = {
    schemaVersion: 1,
    id: createId("unit"),
    workItemId: workItem.id,
    revisionId: workItem.activeRevisionId,
    taskIds: ["T1"],
    goal: "Verify one task",
    state,
    dependencies: [],
    conflictKeys: [],
    expectedChangedAreas: ["packages/core"],
    pullRequestGroup: "P1",
    requiredCapabilities: ["git"],
    expectedEvidenceIds,
  };
  workItem.executionUnitIds ??= [];
  workItem.executionUnitIds.push(unit.id);
  return unit;
}

export function passingEvidence(unit: ExecutionUnit): EvidenceContext {
  const currentHeadSha = "a".repeat(40);
  const currentBaseSha = "b".repeat(40);

  return {
    verdict: {
      schemaVersion: 1,
      id: createId("verdict"),
      unitId: unit.id,
      requirementIds: ["R1"],
      evidenceIds: [...unit.expectedEvidenceIds],
      verifierWorkerId: createId("worker"),
      headSha: currentHeadSha,
      baseSha: currentBaseSha,
      categoryResults: (
        [
          "repository_checks",
          "product_behavior",
          "requirement_coverage",
          "risk_review",
        ] satisfies EvidenceCategory[]
      ).map((category) => ({
        category,
        status: "passed" as const,
        receiptIds: [`receipt-${category}`],
      })),
      artifactReferences: ["evidence.md"],
      verdict: "verified",
      createdAt: "2026-10-08T00:00:00Z",
    },
    currentHeadSha,
    currentBaseSha,
    implementerWorkerId: createId("worker"),
  };
}
