# Kstack agent-runtime discovery

Status: research/intake for the expanded vision, not an approved implementation spec.

## Source and current boundary

The user requested identifiable SDK agents, visible activity and eventual concurrent work while
native Pi remains the workflow orchestrator. They approved resetting the previous Durable role
integration and renaming `packages/pi-runner` to `packages/kstack`, preserving native launch,
setup/update and skill-link ownership safeguards.

The user confirmed that the next spec must cover all nine capability groups below as its overall
scope, not only the first foreground increment. Incremental delivery does not remove later groups
from acceptance. SDK compatibility for bounded execution must be resolved explicitly at Design;
it is not permission to omit that capability, invent a substitute or silently upgrade dependencies.

Commit `16d9ebbb5074957de83692f32f560351ce5a8f62` checkpoints the previous implementation before
that reset. Its core-only spec, approvals and verification remain historical records, not authority
for this expanded runtime. Saved SDK/native data stays untouched; no legacy migration is implied.

Upstream reference: [examples at 86dc686cf2fd795b2b24af3d614bb0e1307bcd76](https://github.com/earendil-works/pi/tree/86dc686cf2fd795b2b24af3d614bb0e1307bcd76/packages/durable/test/examples).
The installed native Pi boundary remains 1.4.0. Current main is not proof of released API compatibility
and is not permission to upgrade dependencies or global tooling.

Compatibility probe: npm currently reports 1.4.0 as the latest released Durable and coding-agent
packages. The [released harness declarations](https://unpkg.com/@earendil-works/pi-durable@1.4.0/dist/harness/types.d.ts)
include conversation watches, inspection and submission reacquisition, but not `continue()` or
`turnLimit`. Thus the visible-foreground foundation has released APIs to investigate; main's example
33 is not a drop-in feature for this release. No dependency or runtime upgrade was performed.

## Example selection

| Need                         | Examples                                            | Intended use                                                                                          |
| ---------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Agent identity/configuration | 06 configuration, 07 conversations                  | Separate agent instances; role, model, tool and directory choices                                     |
| Role behavior                | 25 coding, 26 planning, 27 reviewing                | Explicit coding tools and actual read-only planner/reviewer restrictions                              |
| Visible foreground execution | 18 live state, 20 late join, 21 foreground subagent | Current tool/output/answer, recognizable child activity and immediate current-state attachment        |
| Recovery                     | 12 recovery                                         | SDK-owned storage, reopen and safe/unsafe recovery                                                    |
| Concurrent background work   | 22 background subagent                              | Named agents, SDK ownership, messaging, status/stop and completion reporting                          |
| Busy-agent messaging         | 19 inbox                                            | Steering and queued follow-ups; not an activity display                                               |
| Working directories          | 28 sandbox per conversation                         | Explicit environment assignment; not automatic Git worktree creation or a directory security sandbox  |
| Long-running conversations   | 24 compaction                                       | Keep persistent conversations usable through SDK context management                                   |
| Bounded execution            | 33 turn limit/continue                              | Stop excessive runs and make continuation explicit, subject to an approved SDK compatibility decision |

31 transcript is optional when native presentation needs earlier history/gap loading. 32 tests after
edits is a later choice; its automatic fixer loop is not implicitly adopted. 35–37's Chord host/store/
plugin-registry composition is not required by the current product goal. Other foundations are
learning references rather than a checklist of features to copy.

## First delivery target

A user requests a bounded task in normal native Pi. A named agent with an explicit role/model/project
is visibly active in the native tool output. Its current operation and terminal outcome are
observable before and after attachment/reopen. Planning stays read-only and returns a draft;
implementation requires the existing native workflow/user authority; review is a separate read-only
pass. Errors and cancellation remain explicit rather than old answers being shown as current.

Observe SDK records/views directly; do not introduce another task/status database, scheduler,
transport, coordinator model or replacement UI. An agent's role is not its identity: multiple
implementers would be distinct conversations, not one global "implementer" singleton.

First prove visible foreground execution and recovery. Background orchestration/messaging follows
as a separate verified increment; workspace assignment and operational limits follow when supported.
The current reset does not implement any of these replacement capabilities.

## Design questions for the user-invoked spec workflow

- Examples 21/22 assume a Durable parent. Define the smallest public-API integration that keeps native
  Pi the sole orchestrator, including result/question delivery and cancellation ownership. Do not
  copy the demo's second parent model or invent an RPC/daemon workaround.
- Bind agent identity, conversation/storage lifetime and selected project to an explicit supported
  ownership scope. Preserve old data without silently importing the removed role-state layout.
- Select the native presentation surface and observable states using SDK watches/live records.
  Inbox handles messages, not role activity. Avoid treating "no active run" as evidence of success.
- Verify selected APIs against the installed family before implementation. New main watch/transcript/
  continue examples can differ from 1.4.0; unsupported features require a version/scope decision.
- Herdr recognizes native Pi processes, not arbitrary in-process SDK conversations. Separate Herdr
  rows/panes are a distinct integration/topology decision, not delivered automatically by examples.

These decisions supersede the previous core-only design and require a fresh Requirements → Design
→ Plan approval path before replacement runtime code. The cleanup/rename is independently authorized.
