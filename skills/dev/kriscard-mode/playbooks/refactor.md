# Refactor playbook

> **Read this when:** the selected outcome improves structure while preserving observable behavior.
>
> **Side-effect class:** Mutating. Baseline discovery and planning only in this invocation.

## Required handoffs

Require the general `refactor`, `test`, and `spec` skills. Missing any one stops before product mutation. Use `refactor` to name the structural target and preserved contract, `test` to define preservation evidence, and `spec` for staged approval. Reuse those skills by name rather than copying their methods.

## Procedure

1. Ask `refactor` to identify one structural target, affected callers, and the observable contract that must stay stable; stop before its change step.
2. Ask `test` to identify existing checks or a characterization boundary; record gaps without writing tests.
3. Present the user-invoked `/spec` handoff with the target, preserved contract, affected scope, baseline evidence, and explicit exclusions, then stop.
4. Keep product code, tests, configuration, dependencies, Git state, pull requests, and external systems unchanged.
5. Require approved `spec.md`, `plan.md`, and `approval.md`, matching recorded hashes, and no unresolved blocker. Report their paths and stop.

## Stop conditions

A discovered defect routes as a bug fix; an intentional contract change routes as a feature; a dependency or data-version move routes as a migration. In plain-skills mode, do not promise durable continuation or independent verification.
