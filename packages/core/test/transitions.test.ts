import assert from "node:assert/strict";
import test from "node:test";

import {
  CoreInvariantError,
  transitionExecutionUnit,
  transitionWorkItem,
} from "../src/index.js";

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
        evidenceReadiness: { ready: true },
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

  assert.equal(
    transitionWorkItem({
      ...common,
      from: "verifying",
      to: "ready_for_human",
      actor: "verifier",
      evidenceReadiness: { ready: true },
    }).to,
    "ready_for_human",
  );
});

test("implementers cannot certify their own completion", () => {
  assert.throws(
    () =>
      transitionExecutionUnit({
        ...common,
        from: "verifying",
        to: "verified",
        actor: "implementer",
      }),
    (error) =>
      error instanceof CoreInvariantError &&
      error.code === "UNAUTHORIZED_TRANSITION",
  );

  assert.equal(
    transitionExecutionUnit({
      ...common,
      from: "verifying",
      to: "verified",
      actor: "verifier",
    }).subject,
    "execution_unit",
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
