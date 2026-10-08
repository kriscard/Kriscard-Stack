# Release playbook

> **Read this when:** the selected outcome publishes, deploys, tags, distributes, or promotes an already built artifact.
>
> **Side-effect class:** Mutating. Release planning only in this invocation.

## Required handoffs

Require the general `research`, `test`, and `spec` skills. Missing any one stops before release mutation. Use `research` for current provider, registry, platform, and version rules; use `test` for release evidence; let `spec` own approval. Do not invent a release workflow or copy provider guidance into this playbook.

## Procedure

1. Ask `research` to verify the target channel, installed tooling, version constraints, credentials by reference only, and provider rules from primary evidence.
2. Ask `test` to define preflight, artifact, smoke, rollback, and post-release evidence without publishing anything.
3. Present the user-invoked `/spec` handoff with the exact artifact, destination, version, rollout, rollback, credential boundary, irreversible actions, and final human decision, then stop.
4. Keep versions, changelogs, tags, branches, pull requests, registries, deployments, releases, and external systems unchanged.
5. Require approved `spec.md`, `plan.md`, and `approval.md`, matching recorded hashes, and no unresolved blocker. Report their paths and stop.

## Stop conditions

An unidentified artifact, destination, credential boundary, rollback path, or final human gate is a blocker. Approval permits a later release workflow; it does not publish in this invocation. In plain-skills mode, report durable reconciliation, resumability, and independent release verification as unavailable.
