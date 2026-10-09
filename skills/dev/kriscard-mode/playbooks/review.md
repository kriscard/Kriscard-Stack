# Review playbook

> **Read this when:** the outcome is findings on existing code, selected files, uncommitted changes, a pull request, or a branch comparison.
>
> **Side-effect class:** Read-only.

## Lead responsibility

Own target acquisition, evidence-backed findings, and coverage. Require exactly one general owner:

- `pr-review` for a PR number or URL, named branch comparison, or changes since a fixed point;
- `review` for selected code, files, snippets, uncommitted changes, or current-task changes without a branch comparison.

A missing selected owner blocks this review branch; do not substitute an ad hoc checklist.

## Procedure

1. Resolve the exact target, comparison base where applicable, applicable repository guidance, and originating spec or its absence.
2. Invoke the selected review owner and preserve its evidence, severity, and false-positive standards.
3. Return only findings that pass that owner's validation gate, plus evidence-backed no-findings results, skipped areas, and limitations.
4. Keep posting comments, submitting a platform review, fixing findings, and changing code outside this read-only invocation.

**Complete when:** the full bounded target has an explicit coverage result, every finding has production impact and cited evidence, and limitations or unavailable inputs are named.

## Boundary and output

Do not edit code, tests, configuration, dependencies, Git, issues, PRs, platform reviews, releases, or external systems. Applying or posting a result is a new mutating request governed by the router's shared contract; reuse an existing valid approval only when it covers that exact action.

**Output:** evidence-backed findings grouped by the selected review owner's contract, with coverage and limitations and no side effects.
