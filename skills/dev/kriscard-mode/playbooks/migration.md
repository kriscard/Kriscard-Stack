# Migration playbook

> **Read this when:** the outcome moves data, schemas, dependencies, APIs, platforms, or ownership between versions or representations.
>
> **Side-effect class:** Mutating.

## Lead responsibility

Own the source-to-target transition, compatibility window, ordering, and recovery path. Require general `research` for version-sensitive facts and `test` for migration proof. Consult `architect` only when the migration changes a consequential service, module, protocol, persistence, deployment, or ownership boundary. Require `spec` when approval is absent or scope changes.

## Phase A — Establish the transition and prepare approval

Produce a **migration packet** containing:

- locally evidenced source state and precisely identified target state;
- primary-source compatibility and breaking-change evidence;
- affected data, API, dependency, platform, or ownership boundaries;
- ordered increments, coexistence constraints, and cutover conditions;
- rollback path, or an explicit forward-fix path when rollback is impossible;
- test, data-integrity, protocol, smoke, and cleanup evidence required.

Invoke `architect` only if the boundary decision above is consequential and unresolved. Present the packet through the shared `/spec` gate when needed.

**Complete when:** source, target, ordering, compatibility, and recovery are falsifiable; every irreversible step has an approved response; and any unavailable evidence is a named blocker.

## Phase B — Execute the approved transition

With valid approval and explicit permission, the implementation owner performs only the next approved increment and its preflight checks. Capture before/after state, migration output, compatibility checks, recovery readiness, commit or external-operation receipt, PR identity where applicable, and exact base/head. Advance only after that increment's completion condition holds.

Stop before an unapproved destructive step, boundary change, target-version change, or regrouping. An uncertain external side effect requires reconciliation or human recovery, not automatic replay.

**Complete when:** every executed increment satisfies its integrity and compatibility checks and remains recoverable by the approved rollback or forward-fix path, or the last safe state and blocker are recorded.

## Phase C — Prove and hand off

A fresh verifier checks the exact revision, migrated state, compatibility window, and recovery evidence. Current independent verification proceeds to human acceptance and ordered release/landing.

**Complete when:** every migrated increment has current integrity, compatibility, and recovery proof bound to its exact revision and a recorded human decision or blocker.

**Output:** ordered migration increments with state evidence, recovery status, exact verification bindings, human decisions, and landing or cutover status.
