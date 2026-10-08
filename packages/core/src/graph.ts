import type { UnitId } from "./ids.js";
import type { ExecutionUnit } from "./schemas.js";

export type GraphIssueCode =
  | "DUPLICATE_UNIT"
  | "MISSING_DEPENDENCY"
  | "SELF_DEPENDENCY"
  | "CYCLE"
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
  }

  const visited = new Set<UnitId>();
  const active = new Set<UnitId>();
  const stack: UnitId[] = [];
  const cycleMembers = new Set<UnitId>();

  function visit(unitId: UnitId): void {
    if (active.has(unitId)) {
      const cycleStart = stack.indexOf(unitId);
      for (const member of stack.slice(cycleStart)) cycleMembers.add(member);
      return;
    }
    if (visited.has(unitId)) return;

    active.add(unitId);
    stack.push(unitId);
    for (const dependency of byId.get(unitId)?.dependencies ?? []) {
      if (byId.has(dependency)) visit(dependency);
    }
    stack.pop();
    active.delete(unitId);
    visited.add(unitId);
  }

  for (const unitId of byId.keys()) visit(unitId);
  for (const unitId of cycleMembers) {
    issues.push({ code: "CYCLE", unitId });
  }

  return { valid: issues.length === 0, issues };
}
