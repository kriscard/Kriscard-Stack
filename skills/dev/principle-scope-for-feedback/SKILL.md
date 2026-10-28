---
name: principle-scope-for-feedback
description: >-
  Scope a substantial feature or project whose value or usability remains uncertain
  when feedback would otherwise wait until the whole project is complete. Use
  during planning or an explicitly authorized replan, not to cut approved behavior.
---

# Scope for Useful Feedback

Choose an early learning boundary, not merely smaller implementation tasks.

## Decision rule

**Plan the smallest coherent, safe version that intended users can try and that answers a meaningful product question; defer adjacent functionality explicitly while preserving the guarantees that version needs.**

## Apply the rule

1. Name the uncertainty that feedback should resolve, the intended users, and what observation would support or challenge the proposed behavior. Distinguish “it works as specified” from “it helps these users.” If no material product uncertainty exists, use ordinary delivery planning.
2. Find a complete path through the behavior that those users can exercise. Reduce supported variations, audiences, or optional features before removing guarantees required for safe use. A backend-only task is not a user-feedback boundary unless its intended consumers can meaningfully use it.
3. Specify the retained outcome and guarantees, explicit deferrals, safe exposure boundary, feedback question, observation method, and decision that follows. Use an existing rollout mechanism when suitable; a new flag framework or analytics system needs its own justification and authority.
4. Check dependencies and release safety. If no smaller safe, meaningful version exists, preserve the inseparable work and explain why. An exploratory prototype may answer a design question, but label it as such rather than claiming production readiness.
5. Present the proposed slice for the required scope approval. Execution follows the accepted requirements and plan; actual user contact, deployment, data collection, and publication each remain subject to their action permissions.

## Limits and neighboring owners

- A reduced version must still satisfy its approved semantics, including relevant security, accessibility, data integrity, failure handling, and recovery. “MVP” is not a waiver.
- A feedback slice is not necessarily one pull request. [One Goal per Pull Request](../principle-one-goal-per-pull-request/SKILL.md) owns review grouping; [Develop Complete Capabilities](../principle-build-the-abstraction/SKILL.md) owns mechanism coherence. Preserve both while choosing when learning can begin.
- A small diff, many closed tasks, or passing tests does not demonstrate user value. [Prove Real Behavior](../principle-prove-real-behavior/SKILL.md) covers functional acceptance on real surfaces; product feedback addresses the distinct question of usefulness. Report each honestly.
- Linear's small-team and short-project examples are not fixed staffing or duration rules. Choose scope from the actual uncertainty, dependencies, and safety constraints.
- During approved execution, a newly desirable cut returns through [Stop on Plan Drift](../principle-stop-on-plan-drift/SKILL.md). Proposing a smaller version does not authorize silently dropping accepted behavior.
- `spec` owns planning artifacts and approval; the release playbook owns authorized delivery actions. This principle selects a learning boundary rather than creating another planning or launch workflow.

## Observable change

The plan identifies an early usable version, what it intentionally defers, who could try it safely, what feedback matters, and which next decision that feedback informs. Planned learning remains distinct from collected feedback and verified functionality.

## Evaluation cases

### Positive — usable path before optional variations

**Input:** A reporting project includes one core report, five export formats, saved views, and scheduled delivery. Whether the report answers users' questions is untested.

**Expected:** Propose a complete core report for an approved initial audience with necessary access control and error handling. Explicitly defer optional variations, ask whether users can answer the intended question, and obtain scope approval before implementing the cut.

### Negative — already bounded and understood

**Input:** A small, approved CSV correction has established user value and a precise acceptance test.

**Expected:** Deliver the correction directly. Do not introduce a beta program, product experiment, or new analytics requirement.

### Boundary — inseparable safety work

**Input:** A proposed early account-deletion release would remove primary records but leave sensitive copies in secondary storage without satisfying required deletion guarantees.

**Expected:** Reject that cut as unsafe. Preserve the required deletion semantics or propose an explicitly non-production exploration that cannot affect real accounts.

### Boundary — approved scope and release authority

**Input:** Mid-implementation, a worker notices an opportunity to ship a reduced feature to production, but the accepted plan requires the full behavior and grants no deployment permission.

**Expected:** Preserve valid work, raise the proposed scope change through the planning gate, and keep deployment blocked on its separate authorization. Do not mark planned feedback as collected.

## Source provenance

Adapted from Linear Method's [Scope projects down](https://linear.app/method/scope-projects), [Build with users](https://linear.app/method/build-with-users), and [Launch and keep launching](https://linear.app/method/launching). Early feedback does not replace acceptance checks or release authority.
