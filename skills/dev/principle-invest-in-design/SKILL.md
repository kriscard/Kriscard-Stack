---
name: principle-invest-in-design
description: >-
  Invest bounded design effort when a working feature or fix would introduce or
  preserve demonstrated duplication, dependency, obscurity, or an awkward
  interface in the affected code. Use only when the structural consequence is
  evidenced by the current task; stop rather than expanding into an unapproved
  redesign.
---

# Invest in Design

Leave the affected design as though the requirement had been anticipated, instead of making the smallest working patch the permanent structure.

## Activation evidence

Apply this principle during a feature or fix when the current code and proposed implementation demonstrate that a merely working patch would introduce or preserve at least one of these consequences in the affected path:

- the same decision, policy, or coordination would exist in more than one place;
- a new dependency would point in the wrong direction, leak implementation knowledge, or make unrelated code change together;
- the requirement would remain hidden behind unclear ownership, names, control flow, or state;
- callers would inherit an awkward interface, repeated setup, invalid intermediate state, or knowledge the implementation should own.

Require concrete evidence from the changed path, its callers, tests, or the proposed diff. A preference for a cleaner architecture, possible future reuse, or nearby pre-existing debt is not activation evidence.

## Decision rule

> When the smallest working patch would create or preserve demonstrated structural friction in the affected path, spend bounded effort within the approved task to remove the cause and make the design fit the requirement; stop before unrelated or unapproved redesign.

## Apply the rule

1. State the required behavior and the exact duplication, dependency, obscurity, or interface burden the smallest patch would leave behind.
2. Describe the smallest design that would make the requirement look anticipated. Bound it to the affected responsibility, direct callers, required tests, and approved paths and contracts.
3. Implement the behavior and that bounded design together. Prefer moving one decision to its owner, restoring one dependency direction, clarifying one responsibility, or giving callers one coherent interface over adding a compensating branch or duplicate path.
4. Verify both outcomes: the feature or fix works, and the named structural friction is absent from the resulting diff and affected callers.
5. Report the changed implementation decision and its evidence as `Applied principle-invest-in-design: <friction evidence> changed <smallest patch> to <bounded design investment>.`

## Neighboring owners

- `refactor` owns an explicitly requested behavior-preserving structural job, including its preservation workflow. This principle instead changes how an approved feature or fix is implemented; structural edits remain supporting work for that behavior.
- `codebase-design` owns deeper analysis of module interfaces, seams, locality, and caller burden. Load it when choosing or evaluating such a design; this principle supplies the decision to invest, not a replacement design method.
- `karpathy-guidelines` keeps changes surgical and rejects speculative abstraction. Design investment still must trace directly to the requested behavior and demonstrated friction; “bounded” does not authorize adjacent cleanup.
- `principle-stop-on-plan-drift` owns the stop decision when the needed design changes approved paths, behavior, dependencies, prerequisites, or pull-request grouping. This principle never converts a better design into scope authority.

## Limits and counterexamples

- A truly local patch with one clear owner, no repeated policy, a sound dependency direction, and a fitting interface does not activate the principle. Ship the clean patch.
- Do not redesign a subsystem because the task revealed that a broader architecture could be better. Improve only the portion necessary to prevent the demonstrated consequence in the affected path.
- Do not create an abstraction for hypothetical reuse or trade straightforward code for indirection. The design investment must remove present evidence, not forecast possible needs.
- A tactical mitigation is acceptable for a real emergency, a disposable experiment, or explicitly accepted short-lived debt. Record the consequence, owner or expiry condition, and why the full design investment is deferred.
- If the sound design requires an unapproved contract, dependency, owner, path, or pull-request change, apply `principle-stop-on-plan-drift`; preserve the current state and return to planning rather than silently expanding scope.

## Observable decision

Without this principle, the worker chooses the smallest patch that passes behavior checks and leaves the structural consequence for later. With it, the worker replaces that patch with a bounded implementation that passes the same behavior checks and removes the evidenced duplication, dependency problem, obscurity, or caller burden. When the bounded improvement cannot stay inside the approved task, the observable decision is to stop rather than redesign broadly.

## Evaluation cases

### Positive — feature would duplicate policy

**Input:** A feature needs the same eligibility decision already implemented in one handler. The smallest patch copies that conditional into a second handler, and both handlers serve the same owned responsibility.

**Expected:** Activate the principle. Put the decision in the existing responsibility's coherent owner or interface, update the two direct callers, and verify the feature plus the absence of duplicated policy. Do not defer the second copy as generic cleanup.

### Negative — clean local patch

**Input:** A feature adds one branch to the module that already owns the decision. The branch uses existing dependencies and interfaces, adds no repeated policy, and leaves direct callers unchanged.

**Expected:** Do not activate the principle. Implement and verify the local branch without inventing an abstraction or redesign.

### Boundary — sound design would expand scope

**Input:** Removing an awkward interface would require changing another package's public contract and adding a new dependency not authorized by the approved task. A local mitigation can satisfy the behavior, but the broader redesign would be cleaner.

**Expected:** Do not silently take the broader redesign. Apply `principle-stop-on-plan-drift` and return to planning for the contract and dependency decision. Proceed with the mitigation only if it qualifies as an approved emergency, disposable experiment, or explicitly accepted short-lived debt.
