# Feature playbook

> **Read this when:** the outcome adds or intentionally changes behavior in a new or existing application.
>
> **Side-effect class:** Mutating.

## Lead responsibility

Own the feature outcome from a scoped user need through approved increments. Let `spec` own product decisions and decomposition; load other general skills only when repository evidence triggers them.

## Phase A — Prepare approval

When no valid approval covers the feature, produce a **feature packet** containing:

- actor, current situation, and intended observable outcome;
- acceptance examples and real product surface where they can be observed;
- affected subsystem or new-application boundary;
- explicit exclusions, compatibility needs, and unresolved product decisions;
- candidate increments only as planning input, without silently fixing their grouping.

Present the packet through the router's shared `/spec` gate. Before that approval, the packet is the only output; product code, tests, Git, and external systems remain unchanged.

**Complete when:** every requested behavior has observable acceptance, boundaries and unknowns are explicit, and `/spec` has either received the packet or returned a named blocker.

## Phase B — Deliver approved increments

With a valid approved revision and explicit permission, take each approved feature task in its recorded group and order. The implementation owner writes the behavior and its tests on the assigned branch or worktree using only actually available capabilities. A feature with several dependent steps remains one feature workflow unless the approved outcome coordinates independent goals.

For each increment, record:

- approved task and acceptance IDs;
- changed surface and exclusions preserved;
- test and real-surface evidence produced by the implementation owner;
- commit, PR identity, expected and actual base/head, and remaining dependencies.

Stop and return to planning if implementation requires a new behavior, design, dependency, or PR grouping.

**Complete when:** every in-scope increment is implemented in its approved group with reproducible acceptance evidence, or its exact capability or scope blocker is recorded.

## Phase C — Prove and hand off

Hand each exact PR head to a fresh verifier under the shared contract. After current independent verification, present the increment for human acceptance and release/landing. The implementer does not certify readiness or merge it.

**Complete when:** every delivered increment has a current exact-head verdict and recorded human decision, or its verification or landing blocker is explicit.

**Output:** approved feature increments with PR identities, exact verification bindings, human decisions, and ordered landing status.
