# Review playbook

> **Read this when:** the selected outcome is findings on existing code, selected files, uncommitted changes, a pull request, or a branch comparison.
>
> **Side-effect class:** Read-only.

## Required handoff

Require exactly one general review owner:

- `pr-review` for a pull-request number or URL, named branch comparison, or changes since a fixed point.
- `review` for selected code, files, snippets, uncommitted changes, or code changed in the current task without a branch comparison.

A missing selected owner is a blocker. Do not replace it with an ad hoc review checklist or copy its review rules here.

## Procedure

1. Bound the review target and select `review` or `pr-review` from the target form.
2. Invoke that skill and preserve its evidence and severity standards.
3. Return findings and limitations. Posting comments or submitting a platform review requires a separate explicit request and is mutating, so route it through `/spec`.

Do not edit code, tests, configuration, dependencies, Git state, issues, pull requests, reviews, releases, or external systems. If the user asks to fix a finding, stop this playbook and route the new request as a bug fix, refactor, migration, or feature according to the desired outcome.
