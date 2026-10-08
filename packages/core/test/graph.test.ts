import assert from "node:assert/strict";
import test from "node:test";

import {
  validateExecutionGraph,
  type ExecutionUnit,
  type UnitId,
} from "../src/index.js";
import { createId } from "./helpers.js";

const workItemId = createId("workItem");

function unit(
  taskId: `T${number}`,
  evidenceId: `V${number}`,
  dependencies: UnitId[] = [],
): ExecutionUnit {
  return {
    schemaVersion: 1,
    id: createId("unit"),
    workItemId,
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

test("stack parents must exist, differ from the child, and be dependencies", () => {
  const selfParent = unit("T1", "V1");
  selfParent.stackParentUnitId = selfParent.id;

  const missingParent = unit("T2", "V2");
  missingParent.stackParentUnitId = createId("unit");

  const parent = unit("T3", "V3");
  const unrelatedChild = unit("T4", "V4");
  unrelatedChild.stackParentUnitId = parent.id;

  const result = validateExecutionGraph([
    selfParent,
    missingParent,
    parent,
    unrelatedChild,
  ]);

  assert.deepEqual(
    new Set(result.issues.map(({ code }) => code)),
    new Set([
      "SELF_STACK_PARENT",
      "MISSING_STACK_PARENT",
      "STACK_PARENT_NOT_DEPENDENCY",
    ]),
  );
});

test("deep dependency and stack chains do not overflow the call stack", () => {
  const units: ExecutionUnit[] = [];
  let previous: ExecutionUnit | undefined;

  for (let index = 1; index <= 15_000; index += 1) {
    const taskId: `T${number}` = `T${index}`;
    const evidenceId: `V${number}` = `V${index}`;
    const current = unit(taskId, evidenceId, previous ? [previous.id] : []);
    if (previous) current.stackParentUnitId = previous.id;
    units.push(current);
    previous = current;
  }

  assert.deepEqual(validateExecutionGraph(units), { valid: true, issues: [] });
});

test("stack ancestry cycles fail", () => {
  const first = unit("T1", "V1");
  const second = unit("T2", "V2");
  first.dependencies = [second.id];
  first.stackParentUnitId = second.id;
  second.dependencies = [first.id];
  second.stackParentUnitId = first.id;

  const stackCycleIds = validateExecutionGraph([first, second])
    .issues.filter(({ code }) => code === "STACK_CYCLE")
    .map(({ unitId }) => unitId);

  assert.deepEqual(new Set(stackCycleIds), new Set([first.id, second.id]));
});
