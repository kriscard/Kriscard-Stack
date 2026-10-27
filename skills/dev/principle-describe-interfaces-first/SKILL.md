---
name: principle-describe-interfaces-first
description: >-
  Describe the caller contract before creating or materially changing a public,
  cross-module, or non-obvious interface. Use when callers need explicit guarantees,
  failure behavior, effects, or invariants to use the interface correctly. Skip trivial
  private helpers and contracts already obvious from established types and conventions;
  use the authoritative source for generated interfaces.
---

# Describe Interfaces First

Design the caller's contract before implementation details make the current shape feel inevitable.

## Activation evidence

Apply this principle before implementing an interface when current-task evidence shows both:

1. the interface is public, crosses a module or ownership seam, or has behavior that is not obvious from established types and conventions; and
2. callers must understand at least one meaningful guarantee, error, side effect, ordering rule, lifecycle constraint, or invariant to use it correctly.

A function, class, component, package entry point, service API, event, command, or data exchange can be an interface. Materially changing an existing contract activates the principle just as creating one does.

## Decision rule

**Describe the caller contract before the body, use that description to improve the design, and keep non-obvious guarantees canonical as the implementation evolves.**

The tempting default is to implement first and add comments that narrate the mechanics afterward. Replace it with this short design probe:

1. Name the abstraction and its responsibility. Record policy ownership as "<named actor> owns <decision>". Map that actor to a caller or implementation role only when evidence establishes the relationship; otherwise keep its domain name in the contract and the relationship unresolved.
2. State the accepted inputs and their constraints.
3. State the outputs and guarantees a caller may rely on.
4. Name errors, side effects, lifecycle or ordering rules, and invariants that affect correct use.
5. Check that the description uses caller concepts rather than implementation steps. Trace every promise and caller obligation to an established requirement, contract evidence, or an explicitly selected authorized design choice. Move unsupported claims into open questions before publishing the contract.
6. Treat difficulty explaining the contract as a design warning: distinguish avoidable implementation leakage from inherent constraints. Hide mechanics callers need not know; keep relevant policy with its evidenced owner. A split or new wrapper must reduce total burden, not merely shorten the description. Use `codebase-design` for that analysis and `architect` for consequential choices.
7. Revise the contract and implementation together as coding and testing reveal better semantics, within the authorized task. Comments-first is an iterative design probe, not a frozen upfront specification.

Separate established requirements and settled design choices from proposals and unresolved questions. A new interface may deliberately choose guarantees within the task's authority; an existing contract needs evidence before claiming those guarantees already hold. Label tentative semantics as proposals, resolve caller-essential unknowns before treating the contract as final, and never invent ordering, atomicity, cancellation, or lifecycle promises to fill gaps. A polished comment is not evidence that a promise exists.

A signature describes names and static input/output shapes; it may leave informal guarantees unstated. A type sketch, test name, or chat note can start the probe, but is insufficient when it omits non-obvious behavior. For long-lived interfaces, write or retain a concise canonical description near the declaration or in the existing authoritative schema/API documentation. Reference that source instead of duplicating it. Future callers must be able to find the contract without reconstructing the body or the conversation.

Preserve essential ordering, errors, security, concurrency, and lifecycle constraints even when their explanation is necessarily complex. Improve the design where evidence supports it; never hide required knowledge to make the interface look simple.

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
- `docs` owns standalone API documentation jobs and documentation style; this probe still requires preservation of necessary contract information.
- [principle-stop-on-plan-drift](../principle-stop-on-plan-drift/SKILL.md) owns the stop when a proposed redesign departs from approved paths, behavior, or authority. Invoke it before making that change, rather than treating this probe as redesign authorization.

## Observable decision

When this principle changes the work, a concise caller-facing contract precedes the body, remains discoverable for future callers, and is updated with authorized semantic changes. The resulting action either:

- proceeds because the abstraction, inputs, outputs, failures, effects, and invariants are clear without implementation knowledge, including any inherent constraints;
- changes the proposed interface to reduce caller knowledge or separate responsibilities; or
- stops for an unresolved consequential design decision.

The observable difference is not more prose. It is a usable, maintained contract or a design/authority decision before the affected implementation proceeds.

## Compact example — document replacement

Write this caller contract and signature before filling in the body (design sketch, not executable implementation):

```ts
/** Replace text only if expectedVersion is current and the caller may edit.
 * Returns the committed version. Conflict or denial leaves the document unchanged.
 * Concurrent calls have no submission-order guarantee; one version can win once.
 */
replaceDocument(id, expectedVersion, text): Promise<Version>
```

The editor owns autosave timing and conflict-resolution policy; the document service owns atomic version checks and authorization mechanics. Those concurrency and failure promises remain visible even if they need several sentences. If authorized new semantics return a queued receipt instead of a committed version, revise this canonical contract, signature, implementation, and verification together; a test named “replaces document” cannot preserve that distinction.

## Evaluation cases

### Positive — cross-module cache API

**Input:** A new cache API will be called by several modules. The proposed methods expose `get`, `set`, and `invalidate`, but the design has not decided key scope, missing-value behavior, expiry guarantees, serialization errors, concurrent writes, or whether reads update recency.

**Expected:** Activate the principle. Describe and preserve the non-obvious caller contract before the body, then refine it with implementation/testing evidence. Hide storage-engine mechanics; retain any caller-owned freshness policy. A signature or test name alone cannot communicate expiry, failure, and concurrent-write guarantees.

### Negative — obvious typed private helper

**Input:** A private `isExpired(expiresAt: number, now: number): boolean` helper follows established time conventions, has no side effects, and is used only beside its definition.

**Expected:** Do not activate the principle. Its local name and types already expose the complete contract; additional prose would be ceremony.

### Boundary — generated and complex contracts

**Input:** A generated client exactly reflects an authoritative schema, but a proposed handwritten facade adds retries, batching, partial-result behavior, and cross-module lifecycle rules.

**Expected:** Keep generated methods tied to their authoritative schema without restating each one. Preserve the facade's additional guarantees and failures at its handwritten interface. Use `architect` for consequential lifecycle or compatibility choices; preserve necessary complexity rather than erasing promises.

### Boundary — unresolved promises

**Input:** A new event sink guarantees memory-copy completion for `write` and persistence completion for `flush`. Ordering, cancellation, and post-flush writes have not been decided.

**Expected:** Preserve the two established guarantees in the draft contract. Identify the other semantics as unresolved proposals, settle necessary choices within authority, and only then finalize the caller contract. Do not manufacture FIFO ordering, rollback, or closed-after-flush behavior as though requirements already promised them.

### Authority boundary — redesign outside the approved task

**Input:** Explaining the facade reveals that a sound lifecycle change requires another package's API, while the approved task permits only this package.

**Expected:** Apply `principle-stop-on-plan-drift` before the cross-package redesign. Report the unresolved contract and request owner-spanning authorization; neither add a local imitation nor silently change the other API.

## Source provenance

Adapted from Ousterhout's [Stanford comments notes](https://web.stanford.edu/~ouster/cgi-bin/cs190-winter18/lecture.php?topic=comments) (interface information, comments before bodies, revision, proximity, single documentation source), the author's public [second-edition extract](https://web.stanford.edu/~ouster/cgi-bin/aposd2ndEdExtract.pdf), Chapter 12 pp99–100 (documentation avoids reconstructing intent from code), and his [2024–25 discussion with Martin](https://github.com/johnousterhout/aposd-vs-clean-code#comments) (signatures can omit needed information). This is a bounded workflow adaptation, not a whole-book summary or a requirement to fetch sources at runtime.
