---
name: principle-invest-in-design
description: >-
  Decide how much design effort an approved feature or fix warrants while it is
  being delivered. Use when the immediate patch raises a concrete question about
  contracts, state, dependencies, ownership, or structural friction in the
  affected responsibility; this principle does not grant authority to restructure.
---

# Invest in Design

Treat design as part of ordinary delivery. Consider how the requirement should fit the affected responsibility before committing to the first working patch, then make only the bounded improvement justified by the current requirement, callers, constraints, and task authority.

## Decision rule

> During a feature or fix, invest enough design effort to reduce the demonstrated understanding and change burden in the affected responsibility while preserving required behavior and staying inside the approved task. A clean local patch may already satisfy the rule.

Design consideration does not wait for existing duplication or a completed bad patch. Structural edits do require current evidence and authority: the requirement, affected callers, constraints, or proposed implementation must show why the change improves today's design. A preference for cleaner architecture, nearby legacy debt, or possible future functionality is insufficient.

## Apply the rule

1. **Frame today's responsibility.** State the required behavior, the code that owns it, the direct callers, and the guarantees that must remain stable, including relevant ordering, failure, lifecycle, and performance obligations.
2. **Consider the coherent fit.** Compare the clean local patch with the smallest design improvement that helps the current use. The investment may clarify a contract, documentation, name, state model, dependency direction, or responsibility; it need not create an abstraction.
3. **Establish evidence and authority.** Trace any structural edit to the current requirement, callers, constraints, tests, or proposed diff. Keep it within approved paths, contracts, dependencies, ownership, and pull-request grouping. Better design is not scope authority.
4. **Make one bounded improvement.** Change only the affected responsibility and direct integration needed for the behavior. A somewhat-general interface on first use is justified when it makes today's implementation or callers simpler; predicted adapters, registries, hooks, configuration, or other future functionality are not.
5. **Verify behavior and total burden.** Recheck the observable feature or fix, then compare caller-plus-implementation knowledge and change cost before and after. Include guarantees, sequencing, failures, recovery, and relevant performance constraints. One central owner, fewer branches, or fewer duplicate lines is not proof by itself.
6. **State the honest result.** Identify the demonstrated burden reduced or eliminated, the responsibility changed, and any residual limitation or legacy debt. Do not claim complete cleanup when the improvement is partial, and do not introduce avoidable new debt merely because older debt remains.

## Neighboring owners

- Use `principle-build-the-abstraction` when the material choice is the shape of a new or materially extended mechanism, including its first use. It chooses the capability-shaped increment; this principle decides whether and how much design investment belongs in the delivery.
- Load `codebase-design` for detailed interface, depth, locality, seam, and caller-burden analysis. This principle does not duplicate that method.
- Use `refactor` when behavior-preserving structural improvement is itself the requested job. Here, structural work only supports an approved feature or fix.
- Route consequential or hard-to-reverse boundary choices to `architect`.
- Follow `karpathy-guidelines` for surgical execution and `principle-stop-on-plan-drift` when the sound improvement would exceed approved authority.

## Limits

- A clean local patch with a fitting owner, contract, state model, and dependency direction needs no abstraction, subsystem redesign, or ritual design report.
- Somewhat-general means a coherent interface for current functionality, not hypothetical future functionality. It may be worthwhile before reuse when it reduces today's total burden.
- Improve design incrementally. A bounded reduction is valid when behavior is preserved and residual limitations are explicit; compare the responsibility actually changed and stop when further work leaves the approved task.
- A tactical mitigation is acceptable for a real emergency, a disposable experiment, or explicitly accepted short-lived debt. Record the consequence, why it is deferred, the affected scope, and the owner or expiry condition for follow-up.
- If the improvement requires an unapproved contract, dependency, owner, path, behavior, or pull-request change, apply `principle-stop-on-plan-drift` before making it.

## Observable decision

Without this principle, a worker may either ship the first passing patch without considering its fit or overreact with speculative cleanup. With it, the worker chooses a proportionate, evidence-backed improvement inside the authorized responsibility, verifies behavior and total burden, and reports residual debt honestly. The valid outcome may still be the clean local patch.

## Evaluation cases

### Positive — first-use design before duplication

**Input:** A feature needs the first text-deletion operation in a buffer. A proposed `backspace(cursor)` method mirrors the UI event, while a range deletion operation would make the current buffer logic and contract simpler without adding predicted editor features.

**Expected:** Consider design before a second caller or duplicate appears. Because mechanism shape is material, use `principle-build-the-abstraction` to choose the current coherent operation, keep Backspace policy in the UI, and verify today's behavior and range guarantees. Do not add registries, hooks, or future editing operations.

### Positive — bounded incremental improvement

**Input:** A feature touches a request path with several legacy error translations. The approved package owns one of them, and moving that translation into its existing request contract reduces caller knowledge, but other legacy paths are outside scope.

**Expected:** Make and verify the owned improvement, disclose the residual legacy translations, and avoid declaring the subsystem cleaned up. Do not preserve unnecessary new duplication merely because older debt remains.

### Negative — clean local patch

**Input:** A feature adds one clear condition to the module that already owns the decision. Its contract, callers, dependencies, and state remain coherent.

**Expected:** Implement and verify the local condition. Do not introduce an abstraction, mandatory design report, or subsystem redesign.

### Boundary — preserve behavior and authority

**Input:** A deeper interface would reduce caller burden but requires changing another package's public contract. The approved task permits changes only in the current package, whose local implementation can preserve behavior without imitating the other owner's abstraction.

**Expected:** Do not cross the contract boundary or create a local duplicate. Apply `principle-stop-on-plan-drift`, preserve the authorized work, and request an owner-spanning decision.

### Exception — emergency debt

**Input:** A production outage requires a contained mitigation before the sound design can be completed. The mitigation adds one temporary branch in the affected owner.

**Expected:** Ship the smallest safe mitigation only when the emergency authority is explicit. Record the added consequence, affected scope, deferral reason, and follow-up owner or expiry condition; do not present the mitigation as the completed design.

## Source provenance

This principle adapts the continual, incremental design-investment guidance in John Ousterhout's [strategic programming notes](https://web.stanford.edu/~ouster/cgi-bin/cs190-winter18/lecture.php?topic=working), [modular design notes](https://web.stanford.edu/~ouster/cgi-bin/cs190-winter18/lecture.php?topic=modularDesign), public [second-edition extract](https://web.stanford.edu/~ouster/cgi-bin/aposd2ndEdExtract.pdf), and [2022 interview](https://se-radio.net/2022/07/episode-520-john-ousterhout-on-a-philosophy-of-software-design/). It does not prescribe a fixed investment percentage or quantified return.
