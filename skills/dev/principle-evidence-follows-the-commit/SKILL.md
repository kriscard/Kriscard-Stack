---
name: principle-evidence-follows-the-commit
description: >-
  Keep verification evidence bound to the exact pull-request revision when a
  readiness claim depends on a head SHA, base SHA, lower stack layer, or expected
  evidence set, especially after any of those bindings change.
---

# Evidence Follows the Commit

Use this principle when deciding whether existing evidence can still support a readiness claim. A similar diff, green CI run, or earlier verifier conclusion is not proof for a different revision.

## Activate when

Activate only when all of these are true:

- a decision will rely on implementation or verification evidence;
- the evidence is meant to support readiness for a pull request or execution unit; and
- an exact pull-request identity, head SHA, base SHA, and expected evidence set are available or should be available.

Also activate when the head, base, lower stack layer, or expected evidence set may have changed since evidence was recorded.

## Decision rule

**Accept evidence as current only when its pull-request identity, exact head SHA, exact base SHA, and expected evidence IDs match the revision being judged; otherwise mark the verdict stale and obtain fresh affected evidence before readiness can be claimed.**

## Apply the rule

1. Record the pull-request identity, full head SHA, full base SHA, and expected evidence IDs before verification.
2. Bind every receipt and the independent verifier's verdict to that recorded revision and evidence set.
3. Re-read the actual head and base before presenting the verdict.
4. Compare identities and SHAs, not patch text, tree similarity, branch names, timestamps, or CI labels.
5. If a binding changed, preserve the old receipt as history, mark its verdict `stale`, and rerun the required affected proof against the new exact revision.
6. Report `blocked`, not passing, when the exact revision or required fresh proof cannot be observed.

## Limits and counterexamples

- Do not invalidate a verdict merely because a PR title, label, or discussion changed while its approved scope, exact head, exact base, and evidence set stayed unchanged.
- Do not use this principle to decide which proof methods are sufficient. It governs freshness and binding; product-surface proof and independent-verifier requirements still apply.
- A passing CI result is a receipt, not an independent verification verdict.
- A cherry-pick, rebase, amended commit, or regenerated commit has a new SHA even when its textual patch or tree is identical. Earlier evidence is stale for that new revision.
- A changed lower stacked branch changes the effective base of an upper pull request. The upper verdict is stale until the stack and affected proof are current again.
- Historical evidence remains auditable. Stale means “not valid for current readiness,” not “delete the record.”

## Observable change

The readiness output names the pull request, full head and base SHAs, expected evidence IDs, and verdict status. When a binding changes, the output changes from a passing/current claim to `stale` or `blocked` and identifies the proof that must be rerun. It never carries a verdict forward because two diffs look equivalent.

## Evaluation cases

| Case        | Facts                                                                                                               | Expected decision                                                                      | Why                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| EF-Positive | Verification passed at head `aaa111` and base `bbb222`; the pull-request head is now `ccc333`.                      | Mark the verdict `stale` and rerun required proof at `ccc333`.                         | The exact head bound to the verdict changed.                       |
| EF-Negative | Pull-request identity, head `aaa111`, base `bbb222`, and expected evidence IDs are unchanged; only a label changed. | Keep the verdict current.                                                              | Non-revision metadata did not change any evidence binding.         |
| EF-Boundary | A commit was recreated as `ddd444` with a tree identical to verified head `aaa111`.                                 | Mark the verdict `stale`; identical content does not transfer the verdict to `ddd444`. | Evidence follows commit identity, not textual or tree equivalence. |
