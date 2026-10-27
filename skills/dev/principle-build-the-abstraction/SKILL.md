---
name: principle-build-the-abstraction
description: >-
  Design or materially extend a mechanism, including its first use, as a coherent
  capability rather than an interface shaped around the immediate feature or
  workflow. Use when choosing the development increment and the responsibility of
  its interface. Keep genuinely local one-off code local.
---

# Develop Complete Capabilities

When a feature needs a mechanism, implement the current functionality through a somewhat-general capability whose interface reflects the underlying responsibility, not incidental details of the immediate UI or workflow.

An abstraction is a simpler mental model with useful behavior behind it. A new class, wrapper, extracted function, shared branch, or small method set is not automatically an abstraction.

## Decision rule

**Make the development increment a coherent capability for the current need: keep its common use convenient, place specialization with its proper owner, and reduce the total understanding and change burden across callers and implementation.**

This rule applies on the first use of a mechanism as well as when extending an existing abstraction. “Complete” means complete current semantics, including the lifecycle, ranges, ordering, errors, and performance constraints the capability must own. It does not mean predicting every future use or building a configurable framework.

## Make the decision

1. Name the requested behavior, the underlying mechanism, the caller-owned feature policy, and any implementation-specific specialization. State which details callers need and which are incidental implementation knowledge.
2. When the choice is material, compare:
   - a direct feature-shaped patch;
   - a coherent somewhat-general capability; and
   - an interface that is too primitive or too general.
3. Prefer the capability when it gives callers a simpler model and useful behavior without inventing facilities. Its interface must be convenient for the current use; callers should not have to reconstruct ranges, lifecycle, ordering, recovery, or other semantics the capability claims to provide.
4. Keep specialization at the appropriate level:
   - higher-level code owns feature composition and user-facing policy;
   - the general mechanism owns reusable behavior and guarantees;
   - lower-level implementations own device-, provider-, or representation-specific details.
     Caller control is healthy when it expresses relevant policy. It is leakage when callers must select or coordinate around irrelevant implementation details.
5. Implement the current behavior through the capability. Improve an existing abstraction when it is the natural owner; creating another layer is not the goal.
6. Verify observable behavior and the design claim. Compare the total caller-plus-implementation burden before and after: knowledge required, change locations, guarantees, ordering, errors, recovery, and relevant performance constraints. Method counts and lines changed are not proof.

Load `codebase-design` for detailed interface, depth, seam, locality, and testability analysis. Route a consequential or hard-to-reverse boundary decision to `architect`. Use `refactor` when the authorized work is structural and preserves behavior.

## Limits

- Top-level feature composition may remain feature-oriented; its job is to assemble capabilities into product behavior.
- Keep a genuinely local one-off transformation, presentation choice, or workflow condition local when a capability would not simplify the system.
- Limit the capability to functionality and variation justified by current needs. Defer predicted adapters, registries, plugin systems, configuration surfaces, and extension hooks.
- Preserve explicit guarantees and necessary controls. A shorter signature that hides caller-relevant ordering, failure, concurrency, or performance facts creates obscurity rather than depth.
- Apply `principle-boundary-discipline` when the proper capability owner is outside the authorized boundary. Apply `principle-stop-on-plan-drift` when completing the capability would change approved paths, behavior, dependencies, ownership, or pull-request grouping. These are scope safeguards, not reasons to redesign the whole system.

## Observable changed decision

When this principle changes the work, report:

`Applied principle-build-the-abstraction: <feature-shaped increment> changed to <current coherent capability>, with <caller policy> kept at <owner> and <implementation detail> hidden at <owner>.`

The plan or diff must show the current behavior using that capability and the verification must show both behavior and reduced total burden.

## Evaluation cases

### Positive — first use

**Input:** An editor's first text-deletion feature is Backspace. A proposed text-buffer method is `backspace(cursor)`.

**Decision:** Give the buffer a range operation such as `delete(start, end)` with defined position and range semantics. Keep “the character before the cursor” in the UI handler. Do not add search, plugins, or other predicted editor facilities. Verify Backspace and the buffer's range guarantees.

### Positive — extend the natural owner

**Input:** A client already uses a request capability that owns retries, cancellation, timeout ordering, and error translation. A new “refresh” workflow proposes calling the transport directly because only this screen needs it.

**Decision:** Extend the request capability with the missing current operation and run refresh through it. Keep refresh scheduling and presentation in the screen. Verify the result plus the existing cancellation, ordering, and error guarantees; do not create a refresh-only transport bypass.

### Boundary — legitimate specialization

**Input:** Undo requires a history mechanism, action-specific reversal logic, and UI rules for which edits form one user-visible undo step.

**Decision:** Let history manage action order and traversal, let text or cursor action implementations own their reversal details, and let the UI place grouping boundaries. Do not centralize action behavior or UI grouping policy in history, and do not make the UI manipulate history storage.

### Trap — too primitive

**Input:** A text API offers only single-character insert and delete operations, so every caller loops over ranges, repairs positions, and translates partial failures.

**Decision:** Add coherent range operations that own those semantics. A minimal method set is not deep when callers reconstruct the real operation.

### Trap — too general

**Input:** The first file-export use needs one destination and one format, but a proposal adds provider registration, configurable pipelines, hooks, and a public plugin API.

**Decision:** Provide the current export operation through a destination-independent interface where that simplifies today's caller. Defer the registry, pipeline, hooks, and plugin contract until current requirements justify them.

### Negative — local case

**Input:** One screen changes a private label when a local boolean is true. No underlying mechanism, lifecycle, or reusable operation is missing.

**Decision:** Keep the condition in the screen. A formatter or policy abstraction would add another concept without reducing understanding or change burden.

### Authority boundary

**Input:** The coherent capability belongs to another package's public API, while the approved task permits changes only in the current package.

**Decision:** Apply `principle-boundary-discipline` and `principle-stop-on-plan-drift`. Stop before adding either a local imitation or an unapproved cross-package redesign, and request an owner-spanning plan.

## Source provenance

This principle adapts the somewhat-general interface and specialization guidance in the author's public [second-edition extract](https://web.stanford.edu/~ouster/cgi-bin/aposd2ndEdExtract.pdf), [modular design notes](https://web.stanford.edu/~ouster/cgi-bin/cs190-winter18/lecture.php?topic=modularDesign), and discussion of abstraction-sized increments in [Software Engineering Radio episode 520](https://se-radio.net/2022/07/episode-520-john-ousterhout-on-a-philosophy-of-software-design/). It is a workflow rule, not a complete summary of those sources.
