import assert from "node:assert/strict";
import test from "node:test";

import {
  CoreInvariantError,
  transitionExecutionUnit,
  transitionWorkItem,
} from "../src/index.js";
import { passingEvidence } from "./helpers.js";

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
        from: "requirements_review",
        to: "design_review",
        actor: "human",
      }),
    /canonical UTC timestamp/,
  );
});

test("requirements approval requires a human actor", () => {
  assert.throws(
    () =>
      transitionWorkItem({
        ...common,
        from: "requirements_review",
        to: "design_review",
        actor: "control_plane",
      }),
    (error) =>
      error instanceof CoreInvariantError &&
      error.code === "UNAUTHORIZED_TRANSITION",
  );

  const transition = transitionWorkItem({
    ...common,
    from: "requirements_review",
    to: "design_review",
    actor: "human",
  });
  assert.equal(transition.subject, "work_item");
});

test("work items cannot skip approved stages", () => {
  assert.throws(
    () =>
      transitionWorkItem({
        ...common,
        from: "requirements_review",
        to: "approved",
        actor: "human",
      }),
    (error) =>
      error instanceof CoreInvariantError &&
      error.code === "INVALID_TRANSITION",
  );

  const paused = transitionWorkItem({
    ...common,
    from: "requirements_review",
    to: "paused",
    actor: "system",
  });
  assert.equal(paused.pausedFrom, "requirements_review");
  const pausedFrom = paused.pausedFrom;
  if (!pausedFrom)
    assert.fail("Paused transition did not record its prior state");

  assert.throws(
    () =>
      transitionWorkItem({
        ...common,
        from: "paused",
        to: "plan_review",
        pausedFrom,
        actor: "system",
      }),
    (error) =>
      error instanceof CoreInvariantError &&
      error.code === "INVALID_TRANSITION",
  );

  assert.equal(
    transitionWorkItem({
      ...common,
      from: "paused",
      to: "requirements_review",
      pausedFrom,
      actor: "system",
    }).to,
    "requirements_review",
  );
});

test("work-item readiness requires a verifier and current evidence", () => {
  assert.throws(
    () =>
      transitionWorkItem({
        ...common,
        from: "verifying",
        to: "ready_for_human",
        actor: "implementer",
        evidence: passingEvidence(),
      }),
    (error) =>
      error instanceof CoreInvariantError &&
      error.code === "UNAUTHORIZED_TRANSITION",
  );

  assert.throws(
    () =>
      transitionWorkItem({
        ...common,
        from: "verifying",
        to: "ready_for_human",
        actor: "verifier",
      }),
    (error) =>
      error instanceof CoreInvariantError &&
      error.code === "INVALID_TRANSITION",
  );

  const staleEvidence = passingEvidence();
  staleEvidence.currentHeadSha = "c".repeat(40);
  assert.throws(() =>
    transitionWorkItem({
      ...common,
      from: "verifying",
      to: "ready_for_human",
      actor: "verifier",
      evidence: staleEvidence,
    }),
  );

  assert.equal(
    transitionWorkItem({
      ...common,
      from: "verifying",
      to: "ready_for_human",
      actor: "verifier",
      evidence: passingEvidence(),
    }).to,
    "ready_for_human",
  );
});

test("execution-unit readiness requires a verifier and current evidence", () => {
  assert.throws(
    () =>
      transitionExecutionUnit({
        ...common,
        from: "verifying",
        to: "verified",
        actor: "implementer",
        evidence: passingEvidence(),
      }),
    (error) =>
      error instanceof CoreInvariantError &&
      error.code === "UNAUTHORIZED_TRANSITION",
  );

  assert.throws(() =>
    transitionExecutionUnit({
      ...common,
      from: "verifying",
      to: "verified",
      actor: "verifier",
    }),
  );

  const verified = transitionExecutionUnit({
    ...common,
    from: "verifying",
    to: "verified",
    actor: "verifier",
    evidence: passingEvidence(),
  });
  assert.equal(verified.subject, "execution_unit");

  assert.throws(
    () =>
      transitionExecutionUnit({
        ...common,
        from: "verified",
        to: "ready_for_human",
        actor: "implementer",
        evidence: passingEvidence(),
      }),
    (error) =>
      error instanceof CoreInvariantError &&
      error.code === "UNAUTHORIZED_TRANSITION",
  );

  assert.equal(
    transitionExecutionUnit({
      ...common,
      from: "verified",
      to: "ready_for_human",
      actor: "verifier",
      evidence: passingEvidence(),
    }).to,
    "ready_for_human",
  );
});

test("only a human can accept verified work", () => {
  assert.throws(() =>
    transitionExecutionUnit({
      ...common,
      from: "ready_for_human",
      to: "accepted",
      actor: "control_plane",
    }),
  );

  assert.equal(
    transitionExecutionUnit({
      ...common,
      from: "ready_for_human",
      to: "accepted",
      actor: "human",
    }).to,
    "accepted",
  );
});
