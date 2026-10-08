import assert from "node:assert/strict";
import test from "node:test";

import {
  createId,
  validateExecutionGraph,
  type ExecutionUnit,
  type UnitId,
  type WorkItemId,
} from "../src/index.js";

const workItemId = createId("workItem");

function unit(
  taskId: `T${number}`,
  evidenceId: `V${number}`,
  dependencies: UnitId[] = [],
): ExecutionUnit {
  return {
    schemaVersion: 1,
    id: createId("unit"),
    workItemId: workItemId as WorkItemId,
    taskIds: [taskId],
    goal: `Implement ${taskId}`,
    state: "planned",
    dependencies,
    conflictKeys: [],
    expectedChangedAreas: ["packages/core"],
    pullRequestGroup: taskId,
    requiredCapabilities: ["git"],
    expectedEvidenceIds: [evidenceId],
  };
}

test("a valid dependency graph passes", () => {
  const first = unit("T1", "V1");
  const second = unit("T2", "V2", [first.id]);

  assert.deepEqual(validateExecutionGraph([first, second]), {
    valid: true,
    issues: [],
  });
});

test("missing dependencies and duplicate task owners fail", () => {
  const first = unit("T1", "V1", [createId("unit")]);
  const second = unit("T1", "V2");
  const result = validateExecutionGraph([first, second]);

  assert.equal(result.valid, false);
  assert.deepEqual(
    new Set(result.issues.map(({ code }) => code)),
    new Set(["MISSING_DEPENDENCY", "DUPLICATE_TASK_OWNER"]),
  );
});

test("cycles fail without marking units outside the cycle", () => {
  const first = unit("T1", "V1");
  const second = unit("T2", "V2", [first.id]);
  first.dependencies = [second.id];
  const outside = unit("T3", "V3", [first.id]);

  const cycleIds = validateExecutionGraph([first, second, outside])
    .issues.filter(({ code }) => code === "CYCLE")
    .map(({ unitId }) => unitId);

  assert.deepEqual(new Set(cycleIds), new Set([first.id, second.id]));
});
