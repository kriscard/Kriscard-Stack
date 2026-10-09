# Feature playbook

Build one requested behavior.

1. Confirm the user-visible outcome and constraints. Use `spec` only when requirements or design remain consequentially unclear; use `architect` for a real architecture decision.
2. Inspect the smallest relevant code path. Load the matching framework or domain skills, then implement the narrowest complete change.
3. Use `test` for observable behavior and run the focused checks before broader repository checks.
4. Use `review` on the completed change when risk warrants an independent pass.
5. Return changed behavior, files, executable evidence, and unresolved decisions. Leave commit, PR, deployment, and release actions to explicit user requests.
