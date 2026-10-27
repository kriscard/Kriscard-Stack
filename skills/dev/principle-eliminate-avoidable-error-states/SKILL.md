---
name: principle-eliminate-avoidable-error-states
description: >-
  Use when a design would add an exception, error result, retry branch, or caller
  obligation for a condition that could be normal, idempotent, or impossible by
  construction. Test semantics and invariants before making callers handle it;
  retain explicit failures when callers genuinely need the distinction.
---

# Eliminate Avoidable Error States

Remove error handling that exists only because the operation or model was defined too narrowly. Keep failures explicit when they carry information or require a recovery choice.

## Activation evidence

Apply this principle when a proposed design introduces an exception, error value, retry path, fallback branch, or documented caller obligation for an unusual condition, and current-task evidence suggests at least one of these alternatives may fit:

- the condition already satisfies the operation's intended postcondition;
- repeating the operation can safely have the same result;
- the condition is a normal domain outcome rather than a failed operation; or
- a constructor, type, state transition, or boundary invariant can prevent the condition.

Do not activate merely because an operation can fail. An unexpected production symptom belongs to `debug`; test scope and executable evidence belong to `test`.

## Decision rule

**Before adding an error state, test whether the operation's semantics or an enforceable invariant can make that state normal, idempotent, or impossible. Keep an explicit error when callers need the distinction to protect correctness, choose recovery, or honor a contract.**

Apply the rule before finalizing the interface:

1. Name the condition, the intended postcondition, and the action every caller would have to take.
2. Ask whether the condition already achieves the postcondition, can be defined as a successful repeat, belongs in the normal result model, or can be prevented at construction or transition time.
3. Prefer the smallest honest semantic or invariant change that removes the caller obligation without hiding information.
4. Keep the error explicit when a caller must distinguish the outcome, stop, compensate, retry intentionally, notify a user, or preserve an external contract.
5. Verify the chosen public behavior at its consumer-visible boundary. Route consequential cross-module or external API choices to `architect`, and interface-burden or invariant-placement analysis to `codebase-design`.

## Limits and counterexamples

- Never turn authentication or authorization failures, possible data loss, contract violations, corruption, or security failures into success.
- Preserve failures that require a business or recovery choice, such as a declined payment, rejected write, conflict requiring merge, or unavailable dependency.
- Idempotence must be true for the operation's promised outcome and side effects. Repeated commands that charge, publish, notify, or mutate additional state still need duplicate protection or explicit failure semantics.
- An internal adapter may normalize an external result only when its authorized contract preserves every distinction its callers need. Do not contradict an external protocol merely to simplify local code.
- Preventing a state by construction requires an enforceable invariant at the owning boundary, not an assertion that suppresses a reachable case.
- This principle removes avoidable error states; it does not catch and ignore exceptions, discard diagnostics, return unconditional success, or replace a meaningful failure with a vague fallback.

## Observable decision

When this principle changes a design, the result identifies the candidate error and records one of two outcomes:

- **Eliminated:** the public semantics or owning invariant makes the condition normal, idempotent, or unreachable, and the unnecessary caller branch is absent; or
- **Retained:** the explicit error remains because the caller, user, recovery flow, or external contract needs the distinction.

Report it as `Applied principle-eliminate-avoidable-error-states: <condition> changed <proposed handling> to <semantic, invariant, or explicit-error outcome>.` Do not report the principle when it did not change the decision.

## Evaluation cases

| Kind     | Current-task evidence                                                                                                                                                                                              | Activate | Required decision                                                                                                                                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Positive | A delete command's contract is to ensure a resource is absent. Deleting an already-absent resource has no additional side effects, but the proposed API returns `NotFound` and requires every caller to ignore it. | yes      | Define the delete as idempotent success for the already-absent case and remove the caller retry-or-ignore branch.                                                                                                                          |
| Negative | A payment attempt is declined, and the proposed API preserves a distinct result so the caller can stop fulfillment and let the customer choose another payment method.                                             | no       | Keep the explicit decline result. It is a meaningful business outcome with required caller recovery, not an avoidable error state.                                                                                                         |
| Boundary | An external API distinguishes `404`, authorization failure, and a retryable outage, while a local adapter wants to return success for all three so its callers have no error branch.                               | yes      | Normalize only an authorized already-absent case when the local operation promises idempotent absence. Preserve authorization, outage, external-contract, and recovery distinctions; route a consequential contract change to `architect`. |
