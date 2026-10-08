import assert from "node:assert/strict";
import test from "node:test";

import {
  CoreInvariantError,
  transitionExecutionUnit,
  transitionWorkItem,
} from "../src/index.js";
import {
  createTestUnit,
  createTestWorkItem,
  passingEvidence,
} from "./helpers.js";

const common = {
  reason: "Approved action",
  at: "2026-10-08T00:00:00Z",
  idempotencyKey: "operation-1",
} as const;

test("transitions reject non-canonical timestamps", () => {
  assert.equal(Number.isNaN(Date.parse("2026-10-08")), false);
  assert.throws(
    () =>
      transitionWorkItem({
        ...common,
        at: "2026-10-08",
        workItem: createTestWorkItem("requirements_review"),
        to: "design_review",
        actor: "human",
      }),
    /canonical UTC timestamp/,
  );
});

test("requirements approval requires a human actor", () => {
  const workItem = createTestWorkItem("requirements_review");

  assert.throws(
    () =>
      transitionWorkItem({
        ...common,
        workItem,
        to: "design_review",
        actor: "control_plane",
      }),
    (error) =>
      error instanceof CoreInvariantError &&
      error.code === "UNAUTHORIZED_TRANSITION",
  );

  const transition = transitionWorkItem({
    ...common,
    workItem,
    to: "design_review",
    actor: "human",
  });
  assert.equal(transition.subject, "work_item");
  assert.equal(transition.from, "requirements_review");
});

test("work items cannot skip approved stages", () => {
  assert.throws(
    () =>
      transitionWorkItem({
        ...common,
        workItem: createTestWorkItem("requirements_review"),
        to: "approved",
        actor: "human",
      }),
    (error) =>
      error instanceof CoreInvariantError &&
      error.code === "INVALID_TRANSITION",
  );

  const paused = transitionWorkItem({
    ...common,
    workItem: createTestWorkItem("requirements_review"),
    to: "paused",
    actor: "system",
  });
  assert.equal(paused.pausedFrom, "requirements_review");

  assert.throws(
    () =>
      transitionWorkItem({
        ...common,
        workItem: createTestWorkItem("paused", "requirements_review"),
        to: "plan_review",
        actor: "system",
      }),
    (error) =>
      error instanceof CoreInvariantError &&
      error.code === "INVALID_TRANSITION",
  );

  assert.equal(
    transitionWorkItem({
      ...common,
      workItem: createTestWorkItem("paused", "requirements_review"),
      to: "requirements_review",
      actor: "system",
    }).to,
    "requirements_review",
  );
});

test("work-item readiness requires current evidence for every unit", () => {
  const workItem = createTestWorkItem("verifying");
  const first = createTestUnit(workItem);
  const second = createTestUnit(workItem);
  second.taskIds = ["T2"];
  second.expectedEvidenceIds = ["V2"];
  const evidence = {
    units: [first, second],
    evidence: [passingEvidence(first), passingEvidence(second)],
  };

  assert.throws(
    () =>
      transitionWorkItem({
        ...common,
        workItem,
        to: "ready_for_human",
        actor: "implementer",
        evidence,
      }),
    (error) =>
      error instanceof CoreInvariantError &&
      error.code === "UNAUTHORIZED_TRANSITION",
  );

  assert.throws(() =>
    transitionWorkItem({
      ...common,
      workItem,
      to: "ready_for_human",
      actor: "verifier",
    }),
  );

  const staleEvidence = passingEvidence(second);
  staleEvidence.currentHeadSha = "c".repeat(40);
  assert.throws(() =>
    transitionWorkItem({
      ...common,
      workItem,
      to: "ready_for_human",
      actor: "verifier",
      evidence: {
        units: [first, second],
        evidence: [passingEvidence(first), staleEvidence],
      },
    }),
  );

  assert.equal(
    transitionWorkItem({
      ...common,
      workItem,
      to: "ready_for_human",
      actor: "verifier",
      evidence,
    }).to,
    "ready_for_human",
  );
});

test("paused work items cannot bypass readiness checks", () => {
  const workItem = createTestWorkItem("paused", "ready_for_human");
  const unit = createTestUnit(workItem);
  const evidence = { units: [unit], evidence: [passingEvidence(unit)] };

  assert.throws(
    () =>
      transitionWorkItem({
        ...common,
        workItem,
        to: "ready_for_human",
        actor: "system",
        evidence,
      }),
    (error) =>
      error instanceof CoreInvariantError &&
      error.code === "UNAUTHORIZED_TRANSITION",
  );
  assert.throws(() =>
    transitionWorkItem({
      ...common,
      workItem,
      to: "ready_for_human",
      actor: "verifier",
    }),
  );
  const staleEvidence = passingEvidence(unit);
  staleEvidence.currentHeadSha = "c".repeat(40);
  assert.throws(() =>
    transitionWorkItem({
      ...common,
      workItem,
      to: "ready_for_human",
      actor: "verifier",
      evidence: { units: [unit], evidence: [staleEvidence] },
    }),
  );
  assert.equal(
    transitionWorkItem({
      ...common,
      workItem,
      to: "ready_for_human",
      actor: "verifier",
      evidence,
    }).to,
    "ready_for_human",
  );
});

test("execution-unit readiness requires matching current evidence", () => {
  const workItem = createTestWorkItem();
  const unit = createTestUnit(workItem, "verifying");
  const unrelatedUnit = createTestUnit(workItem, "verifying");

  assert.throws(
    () =>
      transitionExecutionUnit({
        ...common,
        unit,
        to: "verified",
        actor: "implementer",
        evidence: passingEvidence(unit),
      }),
    (error) =>
      error instanceof CoreInvariantError &&
      error.code === "UNAUTHORIZED_TRANSITION",
  );
  assert.throws(() =>
    transitionExecutionUnit({
      ...common,
      unit,
      to: "verified",
      actor: "verifier",
    }),
  );
  assert.throws(() =>
    transitionExecutionUnit({
      ...common,
      unit,
      to: "verified",
      actor: "verifier",
      evidence: passingEvidence(unrelatedUnit),
    }),
  );

  assert.equal(
    transitionExecutionUnit({
      ...common,
      unit,
      to: "verified",
      actor: "verifier",
      evidence: passingEvidence(unit),
    }).from,
    "verifying",
  );
});

test("only a verifier can present a verified unit for human review", () => {
  const workItem = createTestWorkItem();
  const unit = createTestUnit(workItem, "verified");

  assert.throws(
    () =>
      transitionExecutionUnit({
        ...common,
        unit,
        to: "ready_for_human",
        actor: "implementer",
        evidence: passingEvidence(unit),
      }),
    (error) =>
      error instanceof CoreInvariantError &&
      error.code === "UNAUTHORIZED_TRANSITION",
  );

  assert.equal(
    transitionExecutionUnit({
      ...common,
      unit,
      to: "ready_for_human",
      actor: "verifier",
      evidence: passingEvidence(unit),
    }).to,
    "ready_for_human",
  );
});

test("only a human can accept verified work", () => {
  const workItem = createTestWorkItem();
  const unit = createTestUnit(workItem, "ready_for_human");

  assert.throws(() =>
    transitionExecutionUnit({
      ...common,
      unit,
      to: "accepted",
      actor: "control_plane",
    }),
  );

  assert.equal(
    transitionExecutionUnit({
      ...common,
      unit,
      to: "accepted",
      actor: "human",
    }).to,
    "accepted",
  );
});
