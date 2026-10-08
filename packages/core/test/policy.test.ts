import assert from "node:assert/strict";
import test from "node:test";

import {
  createId,
  evaluateBudgets,
  evaluateEvidenceReadiness,
  type BudgetResource,
  type EvidenceCategory,
  type EvidenceVerdict,
} from "../src/index.js";

const resources: BudgetResource[] = [
  "tokens",
  "costUsd",
  "attempts",
  "loopIterations",
  "concurrency",
  "durationMs",
];

const categories: EvidenceCategory[] = [
  "repository_checks",
  "product_behavior",
  "requirement_coverage",
  "risk_review",
];

test("reaching any hard budget pauses further work", () => {
  for (const resource of resources) {
    const result = evaluateBudgets(
      [
        {
          scope: "unit",
          scopeId: "unit-1",
          limits: { [resource]: { hard: 10 } },
        },
      ],
      [
        {
          scope: "unit",
          scopeId: "unit-1",
          used: { [resource]: 10 },
        },
      ],
    );

    assert.equal(result.allowed, false, resource);
    assert.equal(result.exhausted[0]?.resource, resource);
  }
});

test("soft limits warn without blocking", () => {
  const result = evaluateBudgets(
    [
      {
        scope: "program",
        scopeId: "program-1",
        limits: { tokens: { soft: 50, hard: 100 } },
      },
    ],
    [
      {
        scope: "program",
        scopeId: "program-1",
        used: { tokens: 50 },
      },
    ],
  );

  assert.equal(result.allowed, true);
  assert.equal(result.warnings.length, 1);
});

function verdict(): EvidenceVerdict {
  return {
    schemaVersion: 1,
    id: createId("verdict"),
    unitId: createId("unit"),
    requirementIds: ["R1"],
    evidenceIds: ["V1"],
    verifierWorkerId: createId("worker"),
    headSha: "a".repeat(40),
    baseSha: "b".repeat(40),
    categoryResults: categories.map((category) => ({
      category,
      status: "passed",
      receiptIds: [`receipt-${category}`],
    })),
    artifactReferences: ["evidence.md"],
    verdict: "verified",
    createdAt: "2026-10-08T00:00:00Z",
  };
}

test("current independent evidence is ready", () => {
  const evidence = verdict();
  const result = evaluateEvidenceReadiness({
    verdict: evidence,
    currentHeadSha: evidence.headSha,
    currentBaseSha: evidence.baseSha,
    implementerWorkerId: createId("worker"),
  });

  assert.deepEqual(result, { ready: true, reasons: [] });
});

test("stale or self-certified evidence is not ready", () => {
  const evidence = verdict();
  const result = evaluateEvidenceReadiness({
    verdict: evidence,
    currentHeadSha: "c".repeat(40),
    currentBaseSha: "d".repeat(40),
    implementerWorkerId: evidence.verifierWorkerId,
  });

  assert.equal(result.ready, false);
  assert.deepEqual(
    new Set(result.reasons),
    new Set(["STALE_HEAD", "STALE_BASE", "IMPLEMENTER_SELF_VERIFICATION"]),
  );
});

test("duplicate or incomplete evidence categories are not ready", () => {
  const evidence = verdict();
  evidence.categoryResults = [
    evidence.categoryResults[0]!,
    evidence.categoryResults[0]!,
  ];

  const result = evaluateEvidenceReadiness({
    verdict: evidence,
    currentHeadSha: evidence.headSha,
    currentBaseSha: evidence.baseSha,
    implementerWorkerId: createId("worker"),
  });

  assert.equal(result.ready, false);
  assert.deepEqual(
    new Set(result.reasons),
    new Set(["DUPLICATE_CATEGORY", "MISSING_CATEGORY"]),
  );
});
