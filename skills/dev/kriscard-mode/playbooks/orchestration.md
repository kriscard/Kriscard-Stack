# Orchestration playbook

> **Read this when:** the outcome coordinates implementation of multiple independently reviewable goals, tickets, worktrees, workers, or stacked pull requests.
>
> **Side-effect class:** Mutating.

## Lead responsibility

Own fidelity between the approved multi-goal plan and its execution frontier. Consult general `architect` only when a consequential shared service, module, protocol, persistence, deployment, or ownership boundary is unresolved. Require `spec` when approval is absent or goals, dependencies, conflicts, grouping, or design change.

A feature with several implementation steps remains feature. Use this playbook when coordination of independent goals is itself the requested outcome.

## Phase A — Prepare or validate the program

Produce an **orchestration packet** containing:

- each independently reviewable goal and approved task IDs;
- dependency edges, conflict keys, capability needs, and stop conditions;
- PR groups with a reason for every combined group and explicit stack parents;
- expected evidence IDs and verification surfaces per group;
- token or cost, attempt, loop, concurrency, and elapsed-time budgets;
- initiating host and the actual execution capabilities currently available.

Use `architect` only for a consequential unresolved boundary. Present the packet through the shared `/spec` gate when it is new or changes approved structure.

**Complete when:** every goal has one group, dependencies and conflicts are explicit, combined groups are justified, required capabilities and evidence are named, and budgets have falsifiable limits.

## Phase B — Hand off approved execution

If a reachable control plane actually implements the approved compiler and scheduler, hand it the validated packet; do not invent a command or adapter. It may start only dependency-ready, non-conflicting groups within capability and budget limits.

Without that capability, report automatic durable scheduling and crash-safe recovery as unavailable. The operator may explicitly authorize available owners to execute unaffected approved groups manually, one controlled increment at a time, while treating status as non-durable. Do not represent background shells, terminal panes, or chat state as leases or recovery.

For every started group, record owner, host, worktree, branch, PR identity, expected base, permission, and last durable or manual checkpoint. Stop the affected group on scope departure, failed prerequisite, conflict, capability loss, or budget exhaustion; preserve other valid groups.

**Complete when:** eligible groups are handed to real owners without exceeding the approved frontier, while every queued or blocked group has one explicit reason and preserved state.

## Phase C — Aggregate proof and landing

Each group follows the shared exact-head independent verification and human acceptance gates. Whole-program readiness requires current proof for the exact approved group set. Hand accepted PRs to the release playbook for dependency-ordered human-permitted merging; orchestration itself does not merge or silently regroup them.

**Complete when:** every approved group is verified, accepted, landed, queued, or blocked with exact current evidence; aggregate readiness is never inferred from partial completion.

**Output:** program status by approved group, owner, dependency, capability, budget, PR identity, exact verification state, human decision, and ordered landing state.
