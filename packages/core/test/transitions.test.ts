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

  assert.throws(
    () =>
      transitionWorkItem({
        ...common,
        from: "paused",
        to: "approved",
        actor: "system",
      }),
    (error) =>
      error instanceof CoreInvariantError &&
      error.code === "INVALID_TRANSITION",
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
