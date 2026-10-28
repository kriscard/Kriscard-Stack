> **Read this when:** coordinating delegated code review or an authorized review/fix/verification loop; it binds portable review roles to the host's actual capabilities.

# Review execution

The installed `code-review` skill owns the portable review workflow and technical judgment. Load
its matching playbook before preparing code-review handoffs. This reference binds those roles and
completion requirements to the selected host; it is not a second review engine. Use the host's
supported conversations and tools; Git and observed results remain the evidence.

## Agree the boundary before execution

Record the target repository/worktree, scope, base/head or immutable snapshot, requirements, accepted
patterns, output mode, authorized fixes, and required observations. Inspect root and nearest project
instructions. Agree reviewer count/model policy, maximum review/repair rounds, execution time/cost
limits, and which resources may be started or stopped. Normally use two reviewers and one writer;
record a capability/budget reduction explicitly rather than calling a solo pass independent.

Pin relevant context too. For local reviews, include staged, unstaged, and untracked in-scope files
and hashes/snapshot identity for relevant callers, configuration, and tests. Recheck before each
handoff, after repairs, and before readiness. A moving branch label or a diff-only hash is insufficient.

A review-only request ends with findings and coverage. It does not authorize test setup that mutates
files, a fix loop, new workers/worktrees, or platform actions. Ask for missing consequential authority.
If a requested executor or required capability is unavailable, report that blocker and ask before
changing execution mode; do not silently substitute another host.

## Keep roles independent

| Role                | Receives                                                                                                                    | Returns                                                                                                                    | Authority                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Reviewer A and B    | Same intent, revision, diff, relevant callers/tests, applicable rules, accepted patterns, selected skills and quality lens  | Findings with locations, evidence, concrete alternatives, benefit/cost; all applicable axes or evidence-backed no findings | Read-only inspection                                      |
| Lead                | Reviewer results and repository evidence                                                                                    | Act on / Consider / Noted / Dismissed, reasons, accepted correction criteria                                               | Arbitration and handoffs; user owns consequential choices |
| Author              | Accepted findings, allowed paths, preserved behavior, quality criteria, required checks                                     | New revision, changes, actual check results, unresolved issues                                                             | Only approved repairs                                     |
| Fresh verifier      | Final base/head or snapshot, requirements, applicable rules, observable quality criteria, required checks, bounded evidence | Revision-bound pass/fail/blocked, commands, observations, missing evidence                                                 | Approved checks in an isolated environment                |
| Lead evidence audit | Verifier verdict plus actual artifacts, relevant tests/code, revision identity                                              | Supported or rejected readiness claim and exact gaps                                                                       | Audit, not another unbounded agent chain                  |

Use fresh conversations for initial independent reviews and final verification, not a fork carrying
the author's deliberations. Reviewers should not read each other's findings before their first
results. Record actual model identities and any substitutions; diversity helps but consensus cannot
replace evidence. The author or a reviewer who proposed a repair is not its independent final verifier.

Each packet includes goal, revision, applicable rules, selected skills/references, edit/tool boundary,
checks, budget, stop conditions, and expected result. Supply source paths or bounded excerpts, not the
parent transcript. Keep the full quality lens available to each reviewer, not split into personas.

## Bind to the actual host

### Native Pi sessions

Current Kstack launches native Pi; its saved conversations are not the separate Pi Durable harness.
For approved Kstack delegation, load `kstack-orchestrator` and follow the explicit Pi Durable handoff
below. Native Pi remains the coordinator; a native subagent extension or Herdr is not an automatic
substitute for that backend. If a required capability is unavailable, report the blocker and ask the
user before changing the agreed executor or execution mode.

Keep named session IDs and bounded result packets in the coordinating session. Read-only reviewers
may inspect the same pinned checkout while no writer changes it. Writers need exclusive checkout
ownership; give checks that generate files or mutate fixtures an isolated environment. Preserve
sessions/worktrees when blocked. Follow the selected executor's stopping and resumption rules;
a changed revision invalidates affected results after resume too.

### Claude Code

Use Claude Code's native agents with the same role packets, quality standard, and result criteria.
Explicitly supply selected skills/references; do not assume the parent's loaded skills carry over.
Some read-only CLI profiles expose no file tools: supply the actual pinned source, diff, and rules
inline rather than only paths, or report the review blocked. Label inline-only inspection honestly;
it does not independently verify filesystem hashes, commands, or runtime observations.
Use host-supported tool/permission restrictions for read-only inspection. Merely removing Edit and
Write is insufficient if unrestricted shell or MCP tools can still mutate state. Isolate mutable
verification work from the author's checkout.

Use native continuation/resume only as documented for the installed version. Do not claim Pi Durable's
step-level recovery for a Claude session. If agents are unavailable, offer a sequential review and
label its limitation; a required independent full loop remains blocked until its owner accepts a change.

### Pi Durable integration boundary

For approved Kstack delegation, load `kstack-orchestrator` and use its explicit Pi Durable backend
handoff. Interactive Pi remains the coordinator; Durable owns the separate execution's workers,
conversations, storage, cancellation, and recovery. Follow that skill's live command and worker
contracts rather than adding another scheduler or treating a native session as a Durable session.
The general `code-review` skill remains usable without either runtime.

Distinguish persistent storage from memory-only examples, and task cancellation from cancelling a
wait. Recovery must revalidate the revision. Unsafe interrupted operations require inspection;
never blindly replay edits, publication, or destructive actions. Bound rounds and resource use
explicitly rather than looping until the model writes a stop phrase. The harness owns execution
state; it does not make a stored verdict authoritative over changed Git or missing evidence.

## Audit before claiming ready

Inspect the verifier's actual commands and retained outputs, assertion expectations, tested boundary,
observations, and final revision. Ask whether tests can pass without the claimed behavior, whether
expected values merely reuse implementation logic, and whether a mock replaces the actual subject.
Check accepted structural improvements at real interfaces/callers, not by counting lines or searching
for reassuring words. A proxy result is not proof of an unobserved integration.

Repair an evidence gap within the agreed scope/budget, or report it as blocked. Preserve authentic
partial observations: behavior may have been observed even if cleanup failed, but do not call the
whole workflow complete. Stop on scope drift, exhausted budget, unavailable required observation,
unresolved design conflict, or a changed revision. Publication and merge remain user decisions.

## Sources and limits

- [Pstack interrogation](https://github.com/cursor/plugins/blob/9580c23696ac8d7abed0c166f2f9918800afb819/pstack/skills/interrogate/SKILL.md): independent full-context reviews and lead judgment, not hard-coded model IDs.
- [Pi Durable README](https://github.com/earendil-works/pi/blob/f321e5bdd26b3624bfb2ab182a334d0a5edb698a/packages/durable/README.md): persistent storage, ownership, replay, and cancellation semantics. Recheck APIs for the installed version before implementation.
- [Pi Durable reviewer example](https://github.com/earendil-works/pi/blob/f321e5bdd26b3624bfb2ab182a334d0a5edb698a/packages/durable/test/examples/27-reviewer.ts): per-conversation reviewer configuration; its memory storage and text-based continuation are not a production recovery/budget policy.
- [Claude Code subagents](https://code.claude.com/docs/en/sub-agents): native agent configuration, tools, permissions, and explicit skill loading. Runtime compatibility requires exercising the installed host; reading these docs alone is not a passing execution test.
