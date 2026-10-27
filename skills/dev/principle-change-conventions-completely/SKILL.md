---
name: principle-change-conventions-completely
description: >-
  Decide a local change that proposes a different convention for the same kind of
  concept. Use when adopting the new pattern in one place would leave equivalent
  old and new conventions active within the relevant boundary.
---

# Change Conventions Completely

Keep the established convention or replace it through an explicitly bounded complete migration. A locally preferable pattern is not enough reason to leave two conventions for equivalent concepts indefinitely.

## Activation evidence

Apply this principle only when current-task evidence shows both:

1. an established convention and a proposed different convention; and
2. the conventions represent the same kind of concept within a relevant repository, package, or responsibility boundary.

Prove equivalence from observable responsibilities rather than visual similarity. Compare the concepts' purpose, inputs and outputs, invariants, failure behavior, lifecycle and ordering, callers, ownership, and compatibility contract. They are equivalent when callers must make the same decision and the differing representation does not express a real semantic distinction.

Treat equivalence as unproven when the comparison is incomplete or depends only on naming, syntax, library preference, or appearance. Distinct semantics remain distinct even when their implementations look alike.

## Decision rule

> For equivalent concepts, keep the existing convention or perform an explicitly bounded complete migration; do not introduce a second active convention as an isolated improvement.

## Decision sequence

1. Name the existing convention, the proposed convention, the concept each represents, and the approved boundary.
2. Inventory every equivalent occurrence inside that boundary, including producers, consumers, tests, documentation, adapters, generated contracts, and compatibility code that determine which convention remains active.
3. Prove that the occurrences are semantically equivalent using their observable contracts. If equivalence is uncertain, preserve the current distinction and stop for the missing design decision.
4. Choose one path:
   - **Keep:** use the established convention for the local change.
   - **Migrate:** record why the replacement is warranted, authorize the full bounded migration, and define its sequence and evidence before adopting it.
5. Route behavior-preserving unification to the `refactor` workflow owner. Route a versioned dependency, API, data shape, platform, owner, or compatibility transition to the `migration` workflow owner. Use `architect` when choosing the target convention changes a consequential boundary or contract. This principle chooses whether coexistence is acceptable; those workflows own execution.
6. Verify completion against the inventory and the observable contracts, not only against the initially edited file.

## Complete within the boundary

A convention change is complete when every equivalent occurrence in the approved boundary uses the target convention, all intended callers cross the same contract, and no active old producer, consumer, adapter, flag, example, or instruction can perpetuate the retired convention.

The completion claim must name its boundary. A package-complete migration does not imply repository-complete migration. Excluded occurrences remain acceptable only when they are outside the approved boundary or the equivalence test shows distinct semantics; an arbitrary partial inventory is not a boundary.

If temporary coexistence is necessary, define the staged migration before starting:

1. name each compatibility state, such as old-only, dual-read/single-write, and target-only;
2. state which convention is authoritative and which producers and consumers may use each state;
3. order the transitions across affected owners or packages;
4. give every stage entry evidence, exit evidence, rollback path, and approved scope; and
5. name the final removal that ends coexistence.

A dual state without a bounded next transition and target-only completion criterion is an indefinite second convention, not a staged migration.

## Stop or return to planning

Stop before adopting the new convention when:

- the equivalent occurrences cannot be inventoried well enough to define completion;
- equivalence or the target contract is unresolved;
- complete migration requires a package, owner, behavior, dependency, or pull-request group outside the approved task;
- coexistence is required but its compatibility states, sequence, rollback, or final removal are undefined; or
- the proposed migration changes observable behavior under a refactor authorization.

Apply `principle-boundary-discipline` when completion would cross a declared owner or package boundary. Apply `principle-stop-on-plan-drift` when the approved task does not authorize the required migration or changed contract.

## Limits and counterexamples

- Read and write models may intentionally use different types because they express different permissions, validation, or lifecycle states. Their similarity does not make them one convention.
- Domain-specific identifiers, errors, or state machines should remain distinct when the distinction carries meaning. Do not trade semantics for cosmetic consistency.
- A compatibility adapter is valid during a bounded migration when its authority and removal are explicit; it is not evidence that permanent dual conventions are acceptable.
- Generated or externally owned representations may remain different behind an approved adapter. Migrate the owned side of the boundary rather than rewriting another owner's contract.
- A new convention may be used in a genuinely new semantic category without migrating unrelated concepts that merely share syntax.

## Observable outcome

The resulting change does one of three visible things: follows the established convention, completes the named migration boundary, or stops with the exact scope or design decision needed for a complete migration. The diff and verification evidence do not leave unexplained equivalent old and new conventions active inside the claimed completed boundary.

When this principle changes the decision, report `Applied principle-change-conventions-completely: <equivalence and boundary evidence> changed <isolated adoption> to <existing convention, complete migration, or planning stop>.`

## Evaluation cases

### Positive — result type migration

**Input:** One file proposes a new result type for the same success and failure contract used by several call sites in the approved package. The task authorizes changing the whole package, and the inventory covers every producer, consumer, test, and example.

**Expected:** Activate the principle. Either keep the package's existing result type or use the refactor or migration owner to convert every equivalent occurrence and remove the old type within the package. Changing only the first file is incomplete.

### Negative — distinct read and write semantics

**Input:** A read model includes server-derived fields while a write command contains only client-authorized inputs. Their type declarations look similar, and a local edit proposes making them use one shape.

**Expected:** Do not force one convention. The contracts express distinct semantics, permissions, and lifecycle roles, so preserving separate shapes is correct.

### Boundary — staged multi-package migration

**Input:** A staged result-contract migration requires packages `core`, `api`, and `cli`, but the approved task covers only `core`. Keeping `api` and `cli` compatible would require a temporary adapter whose removal depends on those packages changing.

**Expected:** Activate the principle and boundary discipline. Do not call a `core`-only dual state a complete migration or silently edit the other packages. Stop and return to planning for an approved multi-package sequence that names compatibility states, package ownership, transition order, rollback, and final adapter removal.
