# Orchestration playbook

> **Read this when:** the selected outcome coordinates multiple independently reviewable goals, tickets, worktrees, workers, or stacked pull requests.
>
> **Side-effect class:** Mutating. Program planning only in this invocation.

## Required handoffs

Require the general `architect` and `spec` skills. Missing either stops before product or Git mutation. Use `architect` only for consequential goal, dependency, or boundary decisions; let `spec` own requirements, design, task groups, evidence IDs, and approval. Keep general skill guidance in its source repository.

Durable execution also requires a reachable Kriscard Stack control plane. Its absence does not prevent plain-skill planning, but it blocks worker launch, task leases, automatic ready-frontier scheduling, crash-safe resume, and durable evidence tracking.

## Procedure

1. Identify each independently reviewable goal and ask `architect` to clarify only consequential shared boundaries.
2. Present the user-invoked `/spec` handoff with the goals, dependencies, conflicts, capability needs, proposed pull-request groups, stack order, budgets, stop conditions, and required evidence, then stop.
3. Require a reason for every combined pull-request group; do not silently regroup work.
4. Keep product code, tests, dependencies, Git state, worktrees, branches, tickets, pull requests, workers, and external systems unchanged.
5. Require approved `spec.md`, `plan.md`, and `approval.md`, matching recorded hashes, and no unresolved blocker. Report their paths and stop.
6. If durable mode is unavailable, report the execution blocker. If it is available, still stop: a separate approved orchestration workflow must consume the plan.

## Stop conditions

Unresolved dependencies, conflicts, grouping, capability requirements, budgets, or stop conditions block approval. Ordinary sessions, background shells, and terminal panes are not crash-safe orchestration and must not be presented as such.
