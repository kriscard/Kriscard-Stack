---
name: principle-build-the-abstraction
description: >-
  Build a coherent capability when a requested feature reveals that the system
  cannot express the same responsibility across its current demonstrated cases.
  Use before adding a feature-specific branch, option, wrapper, or special case.
  Do not generalize from a genuinely isolated local case.
---

# Build the Abstraction

When a feature exposes a missing system capability, establish that capability and express the feature through it instead of attaching another special case.

## Activation evidence

Apply this principle only when current evidence distinguishes a missing capability from an isolated change. A capability is missing when:

1. the requested feature and existing behavior are current, concrete cases of the same responsibility;
2. they share policy, invariants, lifecycle, errors, or caller coordination that needs one owner; and
3. a feature-specific branch, option, wrapper, or parallel path would leave callers or implementations knowing which case they are handling.

A second case alone is not enough. If the common responsibility is only a name, while behavior and ownership remain unrelated, treat the feature as a local case.

## Decision rule

**Build the smallest complete abstraction required by the current demonstrated cases, then implement the feature through that abstraction.**

Smallest means it contains no variation justified only by predicted future needs. Complete means every current case can use the abstraction without a case-specific escape hatch for the responsibility it claims to own.

## Apply the rule

1. Name the requested feature, the existing case, and the shared responsibility. Record the concrete policy, invariants, errors, lifecycle, or coordination that make them one capability.
2. Test the local alternative. If a branch, option, wrapper, or parallel path would keep all knowledge local without duplicating or leaking the shared responsibility, implement the local case and do not activate this principle.
3. Name the capability owner and its boundary. Keep selection, shared policy, invariants, and errors with that owner; let callers supply only information that genuinely varies.
4. Define the narrow contract that serves every demonstrated case. Load `codebase-design` when detailed interface, seam, depth, or adapter analysis is needed rather than reproducing that method here.
5. Express the existing case and the requested feature through the contract. Remove only the feature-specific decisions that the new owner now makes.
6. Apply the completeness test: every demonstrated case uses the same contract; shared policy has one owner; callers do not branch on the concrete case; and no required current behavior needs an escape hatch around the abstraction.
7. Verify each current case at the closest applicable public boundary. If the abstraction changes several modules, ownership boundaries, or a hard-to-reverse contract, route the design decision to `architect` before implementation.

## Limits and counterexamples

- A genuinely one-off transformation, validation, or UI condition that stays local and creates no repeated caller knowledge does not justify an abstraction.
- Similar syntax does not prove a shared capability. Keep unrelated responsibilities separate even when extracting them would reduce lines of code.
- Do not add registries, plugin systems, generalized configuration, extension hooks, or public APIs unless current demonstrated cases require them.
- Preserve necessary differences behind the contract; completeness does not mean forcing unlike cases into identical implementations.
- Use `refactor` when the approved abstraction can be extracted without changing observable behavior. A new or changed public contract needs explicit approval.
- Apply `principle-boundary-discipline` when the capability would cross or duplicate another owner's responsibility. Use the declared interface or split the work instead of absorbing that owner.
- If the complete abstraction requires paths, behavior, dependencies, ownership, or pull-request grouping outside the approved task, apply `principle-stop-on-plan-drift` and return to planning. Do not ship the special case as a substitute.

## Observable changed decision

When this principle changes the implementation decision, report:

`Applied principle-build-the-abstraction: <current cases and shared responsibility> changed <feature-specific addition> to <capability owner and contract>.`

The diff or plan shows the existing case and new feature using one contract, with shared decisions owned there. When scope or ownership blocks completeness, the observable decision is a stop before either an incomplete abstraction or the special case is added.

## Evaluation cases

| Kind     | Current-task evidence                                                                                                                                                                                                              | Required decision                                                                                                                                                                           |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Positive | A service already exports one format. A requested second export format needs the same destination handling, validation, failure contract, and caller flow; adding it would branch through the service and its callers by format.   | Establish the smallest export capability that owns the shared export contract, express both formats through it, and avoid hooks for unrequested formats.                                    |
| Negative | One screen needs a one-off local label transformation. No other case shares its policy or lifecycle, and the transformation remains private to one component.                                                                      | Keep the transformation local. Do not create a formatter interface, registry, or wrapper.                                                                                                   |
| Boundary | The complete capability would require changing an API owned by another package and the approved task covers only the current package. A local wrapper would hide the ownership conflict but could not own the full responsibility. | Apply `principle-boundary-discipline` and `principle-stop-on-plan-drift`; stop before adding either the wrapper or cross-owner abstraction, and return for an approved owner-spanning plan. |
