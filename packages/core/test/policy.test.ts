import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateBudgets,
  evaluateEvidenceReadiness,
  evaluateWorkItemReadiness,
  type BudgetResource,
  type BudgetUsage,
} from "../src/index.js";
import {
  createId,
  createTestUnit,
  createTestWorkItem,
  passingEvidence,
} from "./helpers.js";

const resources: BudgetResource[] = [
  "tokens",
  "costUsd",
  "attempts",
  "loopIterations",
  "concurrency",
  "durationMs",
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

test("duplicate usage for one budget scope is rejected", () => {
  const usage: BudgetUsage = {
    scope: "unit",
    scopeId: "unit-1",
    used: { tokens: 5 },
  };

  assert.throws(
    () => evaluateBudgets([], [usage, usage]),
    /Duplicate budget usage for unit:unit-1/,
  );
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

function evidenceFixture(expectedEvidenceIds: `V${number}`[] = ["V1"]) {
  const workItem = createTestWorkItem();
  const unit = createTestUnit(workItem, "verifying", expectedEvidenceIds);
  return { unit, evidence: passingEvidence(unit) };
}

test("current independent evidence is ready", () => {
  const { unit, evidence } = evidenceFixture();

  assert.deepEqual(evaluateEvidenceReadiness(unit, evidence), {
    ready: true,
    reasons: [],
  });
});

test("stale head and base evidence fail independently", () => {
  const headFixture = evidenceFixture();
  headFixture.evidence.currentHeadSha = "c".repeat(40);
  const baseFixture = evidenceFixture();
  baseFixture.evidence.currentBaseSha = "d".repeat(40);

  assert.deepEqual(
    evaluateEvidenceReadiness(headFixture.unit, headFixture.evidence),
    { ready: false, reasons: ["STALE_HEAD"] },
  );
  assert.deepEqual(
    evaluateEvidenceReadiness(baseFixture.unit, baseFixture.evidence),
    { ready: false, reasons: ["STALE_BASE"] },
  );
});

test("implementers cannot verify their own evidence", () => {
  const { unit, evidence } = evidenceFixture();
  evidence.implementerWorkerId = evidence.verdict.verifierWorkerId;

  assert.deepEqual(evaluateEvidenceReadiness(unit, evidence), {
    ready: false,
    reasons: ["IMPLEMENTER_SELF_VERIFICATION"],
  });
});

test("invalid head and base SHA values fail independently", () => {
  const headFixture = evidenceFixture();
  headFixture.evidence.verdict.headSha = "not-a-sha";
  headFixture.evidence.currentHeadSha = "not-a-sha";
  const baseFixture = evidenceFixture();
  baseFixture.evidence.verdict.baseSha = "also-not-a-sha";
  baseFixture.evidence.currentBaseSha = "also-not-a-sha";

  assert.deepEqual(
    evaluateEvidenceReadiness(headFixture.unit, headFixture.evidence),
    { ready: false, reasons: ["INVALID_SHA"] },
  );
  assert.deepEqual(
    evaluateEvidenceReadiness(baseFixture.unit, baseFixture.evidence),
    { ready: false, reasons: ["INVALID_SHA"] },
  );
});

test("duplicate or incomplete evidence categories are not ready", () => {
  const { unit, evidence } = evidenceFixture();
  const firstCategory = evidence.verdict.categoryResults[0];
  if (!firstCategory) assert.fail("Verdict fixture has no categories");
  evidence.verdict.categoryResults = [firstCategory, firstCategory];

  const result = evaluateEvidenceReadiness(unit, evidence);

  assert.equal(result.ready, false);
  assert.deepEqual(
    new Set(result.reasons),
    new Set(["DUPLICATE_CATEGORY", "MISSING_CATEGORY"]),
  );
});

test("evidence must match the unit and its exact expected evidence IDs", () => {
  const wrongUnit = evidenceFixture();
  wrongUnit.evidence.verdict.unitId = createId("unit");

  const missingEvidence = evidenceFixture(["V1", "V2"]);
  missingEvidence.evidence.verdict.evidenceIds = ["V1"];

  const unexpectedEvidence = evidenceFixture(["V1"]);
  unexpectedEvidence.evidence.verdict.evidenceIds = ["V1", "V2"];

  const duplicateEvidence = evidenceFixture(["V1"]);
  duplicateEvidence.evidence.verdict.evidenceIds = ["V1", "V1"];

  assert.deepEqual(
    evaluateEvidenceReadiness(wrongUnit.unit, wrongUnit.evidence).reasons,
    ["VERDICT_UNIT_MISMATCH"],
  );
  assert.deepEqual(
    evaluateEvidenceReadiness(missingEvidence.unit, missingEvidence.evidence)
      .reasons,
    ["MISSING_EVIDENCE"],
  );
  assert.deepEqual(
    evaluateEvidenceReadiness(
      unexpectedEvidence.unit,
      unexpectedEvidence.evidence,
    ).reasons,
    ["UNEXPECTED_EVIDENCE"],
  );
  assert.deepEqual(
    evaluateEvidenceReadiness(
      duplicateEvidence.unit,
      duplicateEvidence.evidence,
    ).reasons,
    ["DUPLICATE_EVIDENCE"],
  );
});

test("a work item is ready only when every expected unit has evidence", () => {
  const workItem = createTestWorkItem();
  const first = createTestUnit(workItem);
  const second = createTestUnit(workItem);
  second.taskIds = ["T2"];
  second.expectedEvidenceIds = ["V2"];

  const complete = evaluateWorkItemReadiness(workItem, {
    units: [first, second],
    evidence: [passingEvidence(first), passingEvidence(second)],
  });
  const incomplete = evaluateWorkItemReadiness(workItem, {
    units: [first, second],
    evidence: [passingEvidence(first)],
  });

  assert.deepEqual(complete, { ready: true, reasons: [] });
  assert.deepEqual(incomplete, {
    ready: false,
    reasons: ["MISSING_UNIT_VERDICT"],
  });
});

test("work-item readiness requires the exact unit set from the active revision", () => {
  const workItem = createTestWorkItem();
  const first = createTestUnit(workItem);
  const second = createTestUnit(workItem);
  const extra = createTestUnit(workItem);
  workItem.executionUnitIds?.pop();

  const missing = evaluateWorkItemReadiness(workItem, {
    units: [first],
    evidence: [passingEvidence(first)],
  });
  const unexpected = evaluateWorkItemReadiness(workItem, {
    units: [first, second, extra],
    evidence: [
      passingEvidence(first),
      passingEvidence(second),
      passingEvidence(extra),
    ],
  });
  const duplicate = evaluateWorkItemReadiness(workItem, {
    units: [first, second, second],
    evidence: [passingEvidence(first), passingEvidence(second)],
  });

  assert.deepEqual(missing.reasons, ["MISSING_EXPECTED_UNIT"]);
  assert.deepEqual(unexpected.reasons, ["UNEXPECTED_EXPECTED_UNIT"]);
  assert.deepEqual(duplicate.reasons, [
    "DUPLICATE_EXPECTED_UNIT",
    "GRAPH_DUPLICATE_UNIT",
  ]);
});

test("work-item readiness rejects duplicate, unrelated, and misplaced evidence", () => {
  const workItem = createTestWorkItem();
  const first = createTestUnit(workItem);
  const unrelatedWorkItem = createTestWorkItem();
  const unrelatedUnit = createTestUnit(unrelatedWorkItem);
  const firstEvidence = passingEvidence(first);

  const duplicate = evaluateWorkItemReadiness(workItem, {
    units: [first],
    evidence: [firstEvidence, firstEvidence],
  });
  const unrelated = evaluateWorkItemReadiness(workItem, {
    units: [first],
    evidence: [firstEvidence, passingEvidence(unrelatedUnit)],
  });
  const misplacedUnit = { ...first, workItemId: unrelatedWorkItem.id };
  const misplaced = evaluateWorkItemReadiness(workItem, {
    units: [misplacedUnit],
    evidence: [passingEvidence(misplacedUnit)],
  });

  assert.deepEqual(duplicate.reasons, ["DUPLICATE_UNIT_VERDICT"]);
  assert.deepEqual(unrelated.reasons, ["UNEXPECTED_UNIT_VERDICT"]);
  assert.deepEqual(misplaced.reasons, ["UNIT_WORK_ITEM_MISMATCH"]);
});
