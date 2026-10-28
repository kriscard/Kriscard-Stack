# Feature playbook

Build one requested behavior.

1. Confirm the user-visible outcome and constraints. When consequential requirements or design remain unclear, follow the mode's [requirements handoff](../SKILL.md#requirements-handoff); use `architect` to compare consequential boundary or compatibility choices.
2. Inspect the affected responsibility and direct callers, then load the matching installed language, framework, library, and domain skills. Apply the mode's triggered design principles before implementation: consider the bounded design investment, choose a coherent current capability when a mechanism is needed, and describe non-obvious caller contracts before their bodies. Use `codebase-design` when interface burden or responsibility placement needs analysis. Implement the narrowest complete change for today's semantics; keep genuinely local one-offs local and stay within approved scope.
3. Use `test` to choose observable behavior coverage; load `playwright` for Playwright suites and `msw` when tests depend on request interception. Run focused checks before broader repository checks.
4. Request an independent review when the change affects a trust boundary, public contract, persistent data, or responsibilities across modules, or when the user requires it. Obtain worker authority before delegation; if independence is unavailable, report the gap rather than claiming a pass. For a narrow local change outside those conditions, record the self-review and why no independent pass was required.
5. Return changed behavior, files, executable evidence, and unresolved decisions. Leave commit, PR, deployment, and release actions to explicit user requests.
