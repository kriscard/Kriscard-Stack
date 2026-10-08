import assert from "node:assert/strict";
import test from "node:test";
import { Value } from "@sinclair/typebox/value";

import {
  CoreInvariantError,
  createId,
  HumanGateSchema,
  resolveHumanGate,
  type HumanGate,
} from "../src/index.js";

function gate(): HumanGate {
  return {
    schemaVersion: 1,
    id: createId("gate"),
    workItemId: createId("workItem"),
    question: "Accept this work?",
    reason: "Verification passed",
    allowedDecisions: ["accept", "reject"],
    blockingScope: "work_item",
    createdBy: "control_plane",
    createdAt: "2026-10-08T00:00:00Z",
  };
}

test("gate resolution is one atomic human record", () => {
  const resolved = resolveHumanGate({
    gate: gate(),
    decision: "accept",
    actor: "human",
    resolvedAt: "2026-10-08T01:00:00Z",
  });

  assert.deepEqual(resolved.resolution, {
    decision: "accept",
    resolvedAt: "2026-10-08T01:00:00Z",
    resolvedBy: "human",
  });
  assert.equal(Value.Check(HumanGateSchema, resolved), true);
});

test("non-human and unlisted gate decisions fail", () => {
  assert.throws(
    () =>
      resolveHumanGate({
        gate: gate(),
        decision: "accept",
        actor: "system",
        resolvedAt: "2026-10-08T01:00:00Z",
      }),
    (error) =>
      error instanceof CoreInvariantError &&
      error.code === "UNAUTHORIZED_TRANSITION",
  );

  assert.throws(
    () =>
      resolveHumanGate({
        gate: gate(),
        decision: "auto_accept",
        actor: "human",
        resolvedAt: "2026-10-08T01:00:00Z",
      }),
    (error) =>
      error instanceof CoreInvariantError &&
      error.code === "INVALID_TRANSITION",
  );
});

test("resolved gates cannot be resolved twice", () => {
  const resolved = resolveHumanGate({
    gate: gate(),
    decision: "accept",
    actor: "human",
    resolvedAt: "2026-10-08T01:00:00Z",
  });

  assert.throws(() =>
    resolveHumanGate({
      gate: resolved,
      decision: "reject",
      actor: "human",
      resolvedAt: "2026-10-08T02:00:00Z",
    }),
  );
});

test("partial or non-human resolution shapes fail schema validation", () => {
  assert.equal(
    Value.Check(HumanGateSchema, {
      ...gate(),
      resolution: "auto_accept",
    }),
    false,
  );
  assert.equal(
    Value.Check(HumanGateSchema, {
      ...gate(),
      resolution: {
        decision: "accept",
        resolvedAt: "2026-10-08T01:00:00Z",
        resolvedBy: "system",
      },
    }),
    false,
  );
});
