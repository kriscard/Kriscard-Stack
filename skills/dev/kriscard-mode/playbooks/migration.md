# Migration playbook

> **Read this when:** the selected outcome moves data, schemas, dependencies, APIs, platforms, or ownership between versions or representations.
>
> **Side-effect class:** Mutating. Research and planning only in this invocation.

## Required handoffs

Require the general `research`, `architect`, `test`, and `spec` skills. Missing any one stops before product mutation. Use `research` for version-matched source evidence, `architect` for consequential boundaries and rollback choices, `test` for migration proof, and `spec` for staged approval. Keep their guidance in its owning skill.

## Procedure

1. Ask `research` to establish the current and target versions or representations from local and primary evidence.
2. Ask `architect` to make rollback, compatibility, ordering, and ownership boundaries explicit when consequential.
3. Ask `test` to define observable forward, rollback, and data or protocol compatibility evidence without creating fixtures yet.
4. Present the user-invoked `/spec` handoff with the source and target, evidence, sequencing constraints, rollback or forward-fix path, affected boundaries, and verification needs, then stop.
5. Keep data, product code, tests, configuration, dependencies, Git state, pull requests, releases, and external systems unchanged.
6. Require approved `spec.md`, `plan.md`, and `approval.md`, matching recorded hashes, and no unresolved blocker. Report their paths and stop.

## Stop conditions

An unknown target version, irreversible step without an approved recovery path, or unavailable required evidence is a blocker. In plain-skills mode, do not claim checkpointed migration or safe replay; report those durable capabilities as unavailable.
