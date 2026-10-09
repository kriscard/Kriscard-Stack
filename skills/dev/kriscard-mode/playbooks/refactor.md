# Refactor playbook

> **Read this when:** the outcome improves structure while preserving observable behavior.
>
> **Side-effect class:** Mutating.

## Lead responsibility

Own the preserved contract and the measurable structural improvement. Require general `refactor` for the target and contract, `test` for preservation evidence, and `spec` only when approval is absent or scope changes.

## Phase A — Pin behavior and prepare approval

Use `refactor` to identify one structural target, relevant callers, current public behavior, and intended shape. Use `test` to locate existing proof and define any missing characterization check without writing it. Produce a **refactor packet** containing:

- the structural problem and affected ownership boundary;
- observable APIs, outputs, side effects, errors, ordering, and performance invariants to preserve;
- immediate callers and consumers;
- baseline checks, coverage gaps, and planned equivalence evidence;
- a concrete before/after measure such as fewer branches, narrower ownership, or less duplication.

Present the packet through the shared `/spec` gate when needed.

**Complete when:** the preserved contract and target improvement are independently checkable and every affected caller is accounted for, or an ambiguity blocks approval.

## Phase B — Perform the approved refactor

With valid approval and explicit permission, the implementation owner adds an approved characterization test first when evidence is missing, then makes one coherent structural change. Keep public behavior, dependencies, and boundaries stable. Record baseline and after checks, the measured improvement, commit, PR identity, and exact base/head.

A discovered bug, API change, dependency change, or architectural decision leaves this scope and returns to planning.

**Complete when:** preservation checks match the baseline, the named structural measure improves, and the PR contains no unrelated behavioral change.

## Phase C — Prove and hand off

A fresh verifier checks contract equivalence and the claimed structural improvement at the exact PR head. Current proof proceeds to human acceptance and release/landing; the refactor implementer does not self-certify or merge.

**Complete when:** exact-head independent evidence confirms both preservation and the named improvement, and the human decision or precise blocker is recorded.

**Output:** a behavior-preserving refactor PR with baseline/equivalence evidence, measured improvement, exact verification binding, human decision, and landing status.
