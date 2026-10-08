# Bug-fix playbook

> **Read this when:** the selected outcome corrects behavior that is wrong, failing, flaky, slow, or unsafe.
>
> **Side-effect class:** Mutating. Diagnosis and planning only in this invocation.

## Required handoffs

Require the general `debug`, `test`, and `spec` skills. Missing any one stops before product mutation; name the missing dependency. Use `debug` to establish the symptom, red-capable loop, and causal evidence. Use `test` to define regression evidence. Let `spec` own the staged planning contract. This playbook adds no substitute debugging or testing method.

## Procedure

1. Run `debug` only through causal diagnosis and a reproducible failing signal. Do not apply its fix phase in this invocation.
2. Ask `test` for the narrowest observable regression contract and record it as planning input; do not add the test yet.
3. Present the user-invoked `/spec` handoff with the symptom, expected behavior, reproduction, root-cause evidence or unresolved diagnosis blocker, and required regression proof, then stop.
4. Keep product code, tests, configuration, dependencies, Git state, pull requests, and external systems unchanged.
5. Require approved `spec.md`, `plan.md`, and `approval.md`, matching recorded hashes, and no unresolved blocker. Report their paths and stop.

## Stop conditions

A diagnosis that cannot explain the symptom remains a blocker; do not plan a speculative fix. A requested behavior change that is not a defect returns to routing as a feature. In plain-skills mode, report that durable execution, recovery, and independent verification remain unavailable.
