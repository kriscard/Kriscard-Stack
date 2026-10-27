---
name: principle-describe-interfaces-first
description: >-
  Describe the caller contract before creating or materially changing a public,
  cross-module, or non-obvious interface. Use when callers need explicit guarantees,
  failure behavior, effects, or invariants to use the interface correctly. Skip trivial
  private helpers, generated interfaces, and contracts already obvious from established
  types and conventions.
---

# Describe Interfaces First

Design the caller's contract before implementation details make the current shape feel inevitable.

## Activation evidence

Apply this principle before implementing an interface when current-task evidence shows both:

1. the interface is public, crosses a module or ownership seam, or has behavior that is not obvious from established types and conventions; and
2. callers must understand at least one meaningful guarantee, error, side effect, ordering rule, lifecycle constraint, or invariant to use it correctly.

A function, class, component, package entry point, service API, event, command, or data exchange can be an interface. Materially changing an existing contract activates the principle just as creating one does.

## Decision rule

**First describe the contract from the caller's point of view; if that contract cannot be stated simply without explaining the implementation, redesign the interface before implementing it.**

The tempting default is to implement first and add comments that narrate the mechanics afterward. Replace it with this short design probe:

1. Name the abstraction and the responsibility it owns.
2. State the accepted inputs and their constraints.
3. State the outputs and guarantees a caller may rely on.
4. Name errors, side effects, lifecycle or ordering rules, and invariants that affect correct use.
5. Check that the description uses caller concepts rather than implementation steps.
6. If the description is complex, leaky, or conditional on hidden mechanics, reduce the caller burden, move policy behind the interface, split responsibilities, or route a consequential design decision to `architect`.

The description may be a brief design note, review statement, test name, type sketch, or conversation artifact. Persist API documentation or code comments only when their owning workflow requires them.

## Limits and counterexamples

- A trivial private helper whose complete contract is obvious from its name, local types, and surrounding convention needs no ceremonial description.
- Generated interfaces should derive from their authoritative schema or generator. Apply the probe to a handwritten public facade or generation contract only when callers face additional non-obvious behavior.
- Established types and conventions may already make a contract clear. Do not restate what callers can read directly unless a guarantee, effect, error, or invariant remains hidden.
- A concise description does not excuse weak types, missing runtime validation, or verification through the interface callers actually use.

## Owner composition

This principle owns the pre-implementation caller-contract probe, not the specialized design or documentation work around it:

- `codebase-design` owns analysis of interface burden, module depth, seams, locality, and deeper alternatives.
- `architect` owns consequential choices across modules, owners, deployment boundaries, compatibility, or reversibility.
- `typescript` owns static models, runtime type evidence, generics, assertions, and compiler contracts; framework owners keep platform-specific interfaces aligned with real behavior.
- `docs` owns durable API reference material after the interface decision requires it.

## Observable decision

When this principle changes the work, the implementation record contains a concise caller-facing contract before code is written. The resulting action either:

- proceeds because the abstraction, guarantees, inputs, outputs, failures, effects, and invariants are simple and implementation-independent;
- changes the proposed interface to reduce caller knowledge or separate responsibilities; or
- stops for an unresolved consequential design decision.

The observable difference is not more prose. It is an interface whose callers do not need implementation knowledge, or an explicit redesign before implementation when they otherwise would.

## Evaluation cases

### Positive — cross-module cache API

**Input:** A new cache API will be called by several modules. The proposed methods expose `get`, `set`, and `invalidate`, but the design has not decided key scope, missing-value behavior, expiry guarantees, serialization errors, concurrent writes, or whether reads update recency.

**Expected:** Activate the principle. Describe the cache abstraction and caller contract first, including inputs, outputs, guarantees, errors, side effects, and invariants. Redesign before implementation if callers would need to know storage-engine mechanics or coordinate cache policy themselves.

### Negative — obvious typed private helper

**Input:** A private `isExpired(expiresAt: number, now: number): boolean` helper follows established time conventions, has no side effects, and is used only beside its definition.

**Expected:** Do not activate the principle. Its local name and types already expose the complete contract; additional prose would be ceremony.

### Boundary — generated and complex contracts

**Input:** A generated client exactly reflects an authoritative schema, but a proposed handwritten facade adds retries, batching, partial-result behavior, and cross-module lifecycle rules.

**Expected:** Do not describe every generated method again. Activate for the handwritten facade because its contract is non-obvious; describe its caller-visible guarantees and failures, then route to `architect` if the lifecycle or compatibility decision remains complex or hard to reverse.
