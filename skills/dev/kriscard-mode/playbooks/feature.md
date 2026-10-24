# Feature playbook

Build one requested behavior.

1. Confirm the user-visible outcome and constraints. When consequential requirements or design remain unclear, follow the mode's [requirements handoff](../SKILL.md#requirements-handoff); use `architect` to compare consequential boundary or compatibility choices.
2. Inspect the smallest relevant code path. Load the matching framework or domain skills, then implement the narrowest complete change.
3. Use `test` for observable behavior and run the focused checks before broader repository checks.
4. Request an independent review when the change affects a trust boundary, public contract, persistent data, or responsibilities across modules, or when the user requires it. Obtain worker authority before delegation; if independence is unavailable, report the gap rather than claiming a pass. For a narrow local change outside those conditions, record the self-review and why no independent pass was required.
5. Return changed behavior, files, executable evidence, and unresolved decisions. Leave commit, PR, deployment, and release actions to explicit user requests.
