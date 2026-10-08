import { CoreInvariantError } from "./errors.js";

export type BudgetResource =
  | "tokens"
  | "costUsd"
  | "attempts"
  | "loopIterations"
  | "concurrency"
  | "durationMs";

export type BudgetScope =
  | "program"
  | "work_item"
  | "unit"
  | "attempt"
  | "verifier";

export interface BudgetLimit {
  soft?: number;
  hard: number;
}

export interface BudgetPolicy {
  scope: BudgetScope;
  scopeId: string;
  limits: Partial<Record<BudgetResource, BudgetLimit>>;
}

export interface BudgetUsage {
  scope: BudgetScope;
  scopeId: string;
  used: Partial<Record<BudgetResource, number>>;
}

export interface BudgetHit {
  scope: BudgetScope;
  scopeId: string;
  resource: BudgetResource;
  used: number;
  limit: number;
}

export interface BudgetEvaluation {
  allowed: boolean;
  warnings: BudgetHit[];
  exhausted: BudgetHit[];
}

const resources: BudgetResource[] = [
  "tokens",
  "costUsd",
  "attempts",
  "loopIterations",
  "concurrency",
  "durationMs",
];

/** Evaluates hierarchical usage against soft and hard resource limits. */
export function evaluateBudgets(
  policies: readonly BudgetPolicy[],
  usages: readonly BudgetUsage[],
): BudgetEvaluation {
  const warnings: BudgetHit[] = [];
  const exhausted: BudgetHit[] = [];
  const usageByScope = new Map<string, BudgetUsage>();

  for (const usage of usages) {
    const key = `${usage.scope}:${usage.scopeId}`;
    if (usageByScope.has(key)) {
      throw new CoreInvariantError(
        "INVALID_BUDGET",
        `Duplicate budget usage for ${key}`,
      );
    }
    usageByScope.set(key, usage);
  }

  for (const policy of policies) {
    const usage = usageByScope.get(`${policy.scope}:${policy.scopeId}`);
    for (const resource of resources) {
      const limit = policy.limits[resource];
      if (!limit) continue;
      validateLimit(resource, limit);

      const used = usage?.used[resource] ?? 0;
      if (!Number.isFinite(used) || used < 0) {
        throw new CoreInvariantError(
          "INVALID_BUDGET",
          `${resource} usage must be a non-negative finite number`,
        );
      }

      if (used >= limit.hard) {
        exhausted.push({
          scope: policy.scope,
          scopeId: policy.scopeId,
          resource,
          used,
          limit: limit.hard,
        });
      } else if (limit.soft !== undefined && used >= limit.soft) {
        warnings.push({
          scope: policy.scope,
          scopeId: policy.scopeId,
          resource,
          used,
          limit: limit.soft,
        });
      }
    }
  }

  return { allowed: exhausted.length === 0, warnings, exhausted };
}

function validateLimit(resource: BudgetResource, limit: BudgetLimit): void {
  if (!Number.isFinite(limit.hard) || limit.hard <= 0) {
    throw new CoreInvariantError(
      "INVALID_BUDGET",
      `${resource} hard limit must be a positive finite number`,
    );
  }
  if (
    limit.soft !== undefined &&
    (!Number.isFinite(limit.soft) || limit.soft <= 0 || limit.soft > limit.hard)
  ) {
    throw new CoreInvariantError(
      "INVALID_BUDGET",
      `${resource} soft limit must be positive and no greater than hard`,
    );
  }
}
