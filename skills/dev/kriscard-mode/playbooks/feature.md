# Feature playbook

> **Read this when:** the selected outcome adds or intentionally changes product behavior.
>
> **Side-effect class:** Mutating. Planning only in this invocation.

## Required handoff

Require the general `spec` skill. Missing `spec` stops the planning stage before any mutation. Let `spec` route matching architecture, framework, research, and test skills from repository evidence; do not preload or reproduce their guidance here.

## Procedure

1. Restate the new observable behavior, affected users, and explicit exclusions from the request.
2. Present the user-invoked `/spec` handoff with the request, repository context, and those boundaries, then stop.
3. Leave product code, tests, configuration, dependencies, Git state, pull requests, and external systems unchanged while the separate `/spec` invocation completes its staged reviews.
4. Require approved `spec.md`, `plan.md`, and `approval.md`, matching recorded hashes, and no unresolved blocker.
5. Report the artifact paths and stop. Implementation is a separate approved workflow.

## Stop conditions

Stop before planning if the desired behavior cannot be distinguished from a bug fix or migration. Stop after planning if approval is absent or stale. In plain-skills mode, describe durable execution and independent verification as unavailable rather than implying that the current session supplies them.
