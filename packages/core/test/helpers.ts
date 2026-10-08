import { randomUUID } from "node:crypto";

import {
  createId as createCoreId,
  type AttemptId,
  type EvidenceCategory,
  type EvidenceReadinessInput,
  type GateId,
  type IdKind,
  type MachineId,
  type ProjectId,
  type RevisionId,
  type UnitId,
  type VerdictId,
  type WorkerId,
  type WorkItemId,
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

export function passingEvidence(): EvidenceReadinessInput {
  const currentHeadSha = "a".repeat(40);
  const currentBaseSha = "b".repeat(40);

  return {
    verdict: {
      schemaVersion: 1,
      id: createId("verdict"),
      unitId: createId("unit"),
      requirementIds: ["R1"],
      evidenceIds: ["V1"],
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
