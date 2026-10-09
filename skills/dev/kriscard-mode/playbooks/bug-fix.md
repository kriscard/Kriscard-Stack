# Bug-fix playbook

> **Read this when:** the outcome corrects behavior that is wrong, failing, flaky, slow, or unsafe.
>
> **Side-effect class:** Mutating.

## Lead responsibility

Own the causal claim and closure of the original symptom. Require general `debug` for diagnosis and `test` for regression-proof design when those stages are needed; require `spec` when approval is absent or scope changes. A missing owner blocks only its stage.

## Phase A — Diagnose and prepare approval

Run `debug` through a red-capable reproduction and causal diagnosis without applying its fix phase. Ask `test` for the narrowest observable regression contract without writing the test. Produce a **diagnosis packet** containing:

- observed and expected behavior, environment, and triggering input;
- an already-run red signal or measured intermittent baseline;
- supported causal mechanism, falsified alternatives, or a named observation blocker;
- planned regression proof and same-surface verification;
- affected scope and explicit non-goals.

Present that packet through the shared `/spec` gate when no current approval covers the fix.

**Complete when:** the original symptom is reproducible and causally supported with a regression-proof plan, or diagnosis stops on a specific missing observation rather than proposing a speculative fix.

## Phase B — Fix the approved defect

With valid approval and explicit permission, the implementation owner first adds the approved regression proof when a stable test seam exists, confirms it fails for the original symptom, then applies the smallest approved causal fix. Keep the original loop, input, and environment comparable. Record changed paths, red-to-green evidence, broader checks, commit, PR identity, and exact base/head.

A newly discovered behavior decision, broader redesign, dependency change, or PR regrouping returns to planning before that departure is made.

**Complete when:** the original red loop is green under comparable conditions, required broader checks are recorded, temporary diagnostics are removed, and the PR contains only the approved fix and proof.

## Phase C — Prove and hand off

A fresh verifier repeats the approved proof on the exact PR head and relevant real surface. Current independent verification proceeds to human acceptance and release/landing; the fixer cannot certify or merge its own result.

**Complete when:** the verifier independently closes the original symptom at the exact head and the human decision or precise blocker is recorded.

**Output:** a causal fix PR with reproducible red-to-green evidence, exact verification binding, human decision, and landing status.
