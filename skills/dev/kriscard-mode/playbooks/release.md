# Release playbook

> **Read this when:** the outcome is landing human-accepted verified pull requests or ordered increments; use the artifact-publication branch only when explicitly requested.
>
> **Side-effect class:** Mutating.

## Lead responsibility

Own safe ordered landing. Preserve PR identity, approved grouping and dependency order, expected base/head, current independent verification, required checks, unrelated work, and final human authority. Do not create a new product plan merely to repeat verification, acceptance, or merge already covered by a valid approved task.

## Phase A — Assemble the landing packet

For PR landing, produce a **landing packet** containing:

- approved work item, task group, and every named PR identity;
- dependency and merge order, including lower stack layers;
- expected base and head SHA for each PR;
- current independent verdict bound to that exact base/head and evidence set;
- required check status, unresolved discussions or blockers, and effect on later PRs;
- explicit statement that unrelated user work remains untouched.

If any action falls outside the approved goal or grouping, use the shared `/spec` gate. Otherwise continue from the existing valid approval.

**Complete when:** every PR is uniquely identified and either ready with current exact-head proof or blocked by one named stale, failed, or missing condition.

## Phase B — Obtain human merge permission

Present the landing packet and consequences. Ask the human to accept, merge, reject, pause, or return to planning. Approval and verification are evidence, not merge permission; silence changes nothing.

**Complete when:** the human explicitly names the PRs permitted to merge and their order, or no mutation occurs.

## Phase C — Land in order

For each permitted PR, require an actually available GitHub-capable owner. Immediately before merging, re-read PR identity, base/head, independent verdict, checks, prerequisites, and permission. Merge only that PR, then reconcile its result before considering the next. A changed lower layer makes affected upper proof stale.

Stop at any unverified dependency, stale head or base, changed grouping, unknown remote result, missing capability, or permission mismatch. Never auto-merge, enable auto-merge, force-push, silently rebase or restack, or modify unrelated work.

**Complete when:** every permitted PR is confirmed merged in approved order, or landing stops at the first exact blocker with later PRs untouched.

## Explicit artifact-publication branch

Enter this branch only when the user separately requests publication, deployment, tagging, distribution, or promotion and an approved task covers it. Require general `research` for current provider rules and `test` for preflight, artifact, smoke, rollback, and post-publication evidence. Name the artifact, destination, version, credential boundary, rollback, actual publisher, and explicit human release permission. Unknown or irreversible conditions return to planning or a human gate.

**Complete when:** the explicitly permitted artifact action is reconciled at the named destination with smoke and rollback evidence, or it stops before publication with an exact blocker.

**Output:** reconciled ordered PR landing status by identity and SHA; when separately authorized, artifact publication receipts and post-release evidence.
