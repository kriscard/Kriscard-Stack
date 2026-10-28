# Release playbook

Prepare pull requests, or land work the user has already accepted. Opening a PR is not acceptance
of its changes or permission to merge, deploy, or release them. Select the applicable branch below.

## Pull requests

1. For an explicit request to prepare, open, update or recover a GitHub PR, load the installed
   `create-pr` skill and select its matching playbook. It owns comparison/topology discovery,
   descriptions, publication, updates, recovery and remote verification; keep those rules there.
2. Follow the skill's invocation policy and action gates. If it is user-only, ask the user to invoke
   it; if unavailable, return the change/evidence handoff and exact missing-skill blocker. Do not
   substitute a second PR workflow, install it automatically, or claim the PR action completed.
3. Return its prepared, verified, partial or blocked outcome and stop at the authorized PR boundary.
   PR work may expose incomplete or experimental changes under that skill's policy; it does not
   require pretending they are accepted release work. Technical review remains in `code-review`.

## Merge, publish, deploy or release

1. Identify the exact accepted commit, pull request, artifact, environment, and required checks.
2. Verify current status and use the repository's established release or deployment skill when one exists.
3. Show the consequential action and obtain explicit user approval immediately before merge, publish, deploy, or release.
4. Perform only the approved action, then verify the resulting remote state.
5. Return the released identity, evidence, and any rollback or follow-up information.
