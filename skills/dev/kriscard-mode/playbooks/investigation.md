# Investigation playbook

> **Read this when:** the selected outcome is evidence, explanation, diagnosis, or an audit without applying a change.
>
> **Side-effect class:** Read-only.

## Required handoff

Choose the one general skill that owns the requested evidence:

- `debug` for a concrete broken, flaky, slow, or unexplained symptom; stop before its fix phase.
- `research` for a version-sensitive library, framework, SDK, provider, or API question.
- `analyze-repo` for an explicitly requested whole-repository architecture or technical-debt audit.

If none matches, ask what evidence or scope the user wants. If the matching skill is missing, stop and name the missing dependency instead of improvising its workflow. Load additional general skills only when the chosen owner explicitly routes to them.

## Procedure

1. State the question, bounded scope, and observation that would answer it.
2. Invoke the matching general skill with an explicit read-only boundary.
3. Read repository state and external sources only as required for that evidence.
4. Return findings, evidence, uncertainty, and any blocked observation.

Do not edit files, install dependencies, change Git state, write issues or pull requests, publish, deploy, release, or alter an external system. Temporary private tool output may be created outside the repository only when the selected skill requires it and cleanup is explicit.

If the user asks to apply a finding, stop this playbook and route the new mutating request through `/spec`.
