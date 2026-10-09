---
name: principle-prove-real-behavior
description: >-
  Require observable proof when current-task acceptance criteria name behavior on
  a real product, user, process, or integration surface and that surface is
  applicable. Use when unit tests, mocks, types, or CI do not exercise the required
  wiring. Do not load for a purely internal invariant already observable at its
  public programmatic boundary.
---

# Prove Real Behavior

Treat lower-level checks as supporting evidence when the requirement is about behavior visible through a real surface.

## Activation gate

Apply this principle only when evidence in the current task establishes both:

1. an acceptance claim observable through a product, user, process, service, command, browser, device, or integration surface; and
2. a risk that the available lower-level checks do not exercise that surface or its real wiring.

Evidence can come from approved acceptance criteria, a product verification map, the changed integration path, or a demonstrated gap between checks and the running behavior. Do not activate from the word “test” alone or demand an unrelated end-to-end flow.

## Decision rule

**Exercise the closest safe, applicable real surface that can falsify the acceptance claim, and do not mark the claim proven until the expected outcome is observed there.**

Apply the rule during verification:

1. State the acceptance claim and the consumer-visible observation point.
2. Use the approved start, navigate, exercise, inspect, capture, and cleanup guidance when present.
3. Exercise only disposable or explicitly authorized state and retain the exact observation or blocker.
4. Treat tests, types, mocks, and CI as supporting evidence, not substitutes, when they stop below the required surface.
5. If the required surface or capability is unavailable, return a precise blocker. Never convert unavailable observation into a pass.

## Limits and counterexamples

- A pure function, parser, schema, or internal state transition can be fully proven at its public programmatic boundary when no approved claim depends on additional runtime wiring.
- Use the closest surface that can falsify the claim. Do not broaden a command-line acceptance claim into browser, device, or production testing without evidence.
- Never exercise real credentials, private user data, production side effects, or an unsafe cleanup path merely to obtain proof. Use an approved disposable fixture or block.
- Do not install an unavailable dependency, simulator, service, or security control unless separately approved.
- This principle does not authorize implementation changes. A failed observation is evidence to report through the owning workflow.

## Observable changed decision

When this principle materially changes a decision, the verification output includes:

- the acceptance claim and real observation point;
- the action performed on a safe applicable surface;
- the observed result and reproducible evidence; and
- supporting checks, cleanup, or the exact unavailable-capability blocker.

The decision changes from “checks passed” to either “behavior observed on the required surface,” “behavior failed on that surface,” or “proof blocked.” Report it as `Applied principle-prove-real-behavior: <surface evidence> required <observation or blocker>.` Do not report the principle when it did not change the decision.

## Evaluation cases

| Kind     | Current-task evidence                                                                                                                                     | Activate | Required decision                                                                                                                   |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Positive | Acceptance requires a user to submit a form in the running app, while green unit tests mock the network and a disposable browser fixture is available.    | yes      | Exercise form submission through the disposable running app and require the visible result; keep unit tests as supporting evidence. |
| Negative | Acceptance covers a pure parser's returned value, and focused tests call its public API with representative inputs without any additional runtime wiring. | no       | Use the focused public-API tests as the behavior proof; do not invent a browser or manual product flow.                             |
| Boundary | Acceptance requires behavior on a mapped device surface, but the required simulator or approved device is unavailable and lower-level tests pass.         | yes      | Record the missing capability and block the proof; do not install the capability or report verification from tests alone.           |
