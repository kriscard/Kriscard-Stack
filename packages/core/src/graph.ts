import type { UnitId } from "./ids.js";
import type { ExecutionUnit } from "./schemas.js";

export type GraphIssueCode =
  | "DUPLICATE_UNIT"
  | "MISSING_DEPENDENCY"
  | "SELF_DEPENDENCY"
  | "CYCLE"
  | "MISSING_STACK_PARENT"
  | "SELF_STACK_PARENT"
  | "STACK_PARENT_NOT_DEPENDENCY"
  | "STACK_CYCLE"
  | "DUPLICATE_TASK_OWNER"
  | "DUPLICATE_EVIDENCE_OWNER";

export interface GraphIssue {
  code: GraphIssueCode;
  unitId: UnitId;
  relatedId?: string;
}

export interface GraphValidation {
  valid: boolean;
  issues: GraphIssue[];
}

/** Validates task ownership, dependencies, and pull-request stack ancestry. */
export function validateExecutionGraph(
  units: readonly ExecutionUnit[],
): GraphValidation {
  const issues: GraphIssue[] = [];
  const byId = new Map<UnitId, ExecutionUnit>();
  const taskOwners = new Map<string, UnitId>();
  const evidenceOwners = new Map<string, UnitId>();

  for (const unit of units) {
    if (byId.has(unit.id)) {
      issues.push({ code: "DUPLICATE_UNIT", unitId: unit.id });
      continue;
    }
    byId.set(unit.id, unit);

    for (const taskId of unit.taskIds) {
      const owner = taskOwners.get(taskId);
      if (owner) {
        issues.push({
          code: "DUPLICATE_TASK_OWNER",
          unitId: unit.id,
          relatedId: taskId,
        });
      } else {
        taskOwners.set(taskId, unit.id);
      }
    }

    for (const evidenceId of unit.expectedEvidenceIds) {
      const owner = evidenceOwners.get(evidenceId);
      if (owner) {
        issues.push({
          code: "DUPLICATE_EVIDENCE_OWNER",
          unitId: unit.id,
          relatedId: evidenceId,
        });
      } else {
        evidenceOwners.set(evidenceId, unit.id);
      }
    }
  }

  for (const unit of byId.values()) {
    for (const dependency of unit.dependencies) {
      if (dependency === unit.id) {
        issues.push({
          code: "SELF_DEPENDENCY",
          unitId: unit.id,
          relatedId: dependency,
        });
      } else if (!byId.has(dependency)) {
        issues.push({
          code: "MISSING_DEPENDENCY",
          unitId: unit.id,
          relatedId: dependency,
        });
      }
    }

    const stackParent = unit.stackParentUnitId;
    if (!stackParent) continue;
    if (stackParent === unit.id) {
      issues.push({
        code: "SELF_STACK_PARENT",
        unitId: unit.id,
        relatedId: stackParent,
      });
    } else if (!byId.has(stackParent)) {
      issues.push({
        code: "MISSING_STACK_PARENT",
        unitId: unit.id,
        relatedId: stackParent,
      });
    } else if (!unit.dependencies.includes(stackParent)) {
      issues.push({
        code: "STACK_PARENT_NOT_DEPENDENCY",
        unitId: unit.id,
        relatedId: stackParent,
      });
    }
  }

  const unitIds = [...byId.keys()];
  const cycleMembers = findCycleMembers(unitIds, (unitId) =>
    (byId.get(unitId)?.dependencies ?? []).filter((dependency) =>
      byId.has(dependency),
    ),
  );
  for (const unitId of cycleMembers) {
    issues.push({ code: "CYCLE", unitId });
  }

  const stackCycleMembers = findCycleMembers(unitIds, (unitId) => {
    const parent = byId.get(unitId)?.stackParentUnitId;
    return parent && parent !== unitId && byId.has(parent) ? [parent] : [];
  });
  for (const unitId of stackCycleMembers) {
    issues.push({ code: "STACK_CYCLE", unitId });
  }

  return { valid: issues.length === 0, issues };
}

function findCycleMembers(
  nodes: readonly UnitId[],
  neighbors: (node: UnitId) => readonly UnitId[],
): Set<UnitId> {
  const visited = new Set<UnitId>();
  const activeIndexes = new Map<UnitId, number>();
  const cycleMembers = new Set<UnitId>();

  for (const root of nodes) {
    if (visited.has(root)) continue;

    const path: UnitId[] = [];
    const frames: Array<{
      node: UnitId;
      neighbors: readonly UnitId[];
      nextNeighbor: number;
    }> = [{ node: root, neighbors: neighbors(root), nextNeighbor: 0 }];
    activeIndexes.set(root, 0);
    path.push(root);

    while (frames.length > 0) {
      const frame = frames.at(-1);
      if (!frame) break;

      if (frame.nextNeighbor < frame.neighbors.length) {
        const neighbor = frame.neighbors[frame.nextNeighbor];
        frame.nextNeighbor += 1;
        if (!neighbor) continue;

        const cycleStart = activeIndexes.get(neighbor);
        if (cycleStart !== undefined) {
          for (const member of path.slice(cycleStart)) {
            cycleMembers.add(member);
          }
        } else if (!visited.has(neighbor)) {
          activeIndexes.set(neighbor, path.length);
          path.push(neighbor);
          frames.push({
            node: neighbor,
            neighbors: neighbors(neighbor),
            nextNeighbor: 0,
          });
        }
        continue;
      }

      frames.pop();
      path.pop();
      activeIndexes.delete(frame.node);
      visited.add(frame.node);
    }
  }

  return cycleMembers;
}
