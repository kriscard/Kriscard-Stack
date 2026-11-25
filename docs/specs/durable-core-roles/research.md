# Sources and discovery: Durable core roles

## User decisions

- Delete the previous Durable integration and start fresh from official examples.
- Native Pi launched by Kstack remains the orchestrator and loads Kriscard Mode by default.
- Start with planner, implementer and reviewer roles. Background orchestration and other additions come later.
- SSH/Mosh and persistent terminal sessions are external to Kstack.
- No custom socket server, RPC/JSON job protocol, detached host, replacement UI or speculative infrastructure.

## Primary examples

Source snapshot: `earendil-works/pi` commit `e7a0df27c09d11bf4161d3605246cbf57a129cb2`. These are reference implementations, not a dependency-upgrade instruction.

| Responsibility | Official source                                                                                                                                            | What to retain                                                                    |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Planner        | [26-plan-mode.ts](https://github.com/earendil-works/pi/blob/e7a0df27c09d11bf4161d3605246cbf57a129cb2/packages/durable/test/examples/26-plan-mode.ts)       | Read and submit-plan tools, an SDK plan document and explicit role/tool selection |
| Implementer    | [25-coding-agent.ts](https://github.com/earendil-works/pi/blob/e7a0df27c09d11bf4161d3605246cbf57a129cb2/packages/durable/test/examples/25-coding-agent.ts) | CodingTools, settings and an environment following the conversation's directory   |
| Reviewer       | [27-reviewer.ts](https://github.com/earendil-works/pi/blob/e7a0df27c09d11bf4161d3605246cbf57a129cb2/packages/durable/test/examples/27-reviewer.ts)         | Separate conversation, explicit model/role/directory and read-only tool selection |
| Persistence    | [12-recovery.ts](https://github.com/earendil-works/pi/blob/e7a0df27c09d11bf4161d3605246cbf57a129cb2/packages/durable/test/examples/12-recovery.ts)         | Persistent SQLite and SDK close/reopen recovery                                   |

Examples 25–27 use scripted models/memory storage to demonstrate behavior. Their demos are not production persistence or native-Pi integration. Example 26 stores steps in an SDK document; it does not generate this repository's full approved-spec artifact set. Example 27 demonstrates a review continuation hook, not human approval or an implementation repair service.

Native Pi and Durable have different extension contracts. A small native-Pi entry point must call the SDK roles; a skill alone does not execute an SDK extension. The precise public-API composition belongs to Technical Design, not an invented transport or another coordinating model.

## Repository baseline after the authorized cleanup

- Branch: `feat/config-update`; HEAD: `0c951677d7e8f4586396c6316e0718786bf14400`.
- The checkout remains dirty. Do not reset it or infer a clean revision from HEAD.
- Removed: runner `src/durable/`, generated `dist/durable/`, old agent tests/fixture, `docs/specs/minimal-pi-durable-app/`, old orchestrator command/reference/evaluation content and direct Durable/Chord/pi-ai dependencies.
- `kstack-orchestrator` retains only a capability-unavailable notice and ordinary scope/authority guidance, not an executable backend.
- `src/cli.ts` rejects the removed `agents`/`durable` entry points rather than interpreting their old flags as a native session request.
- `src/launcher.ts` still opens native Pi, adds Kriscard Mode and preserves native argument/stdio behavior.
- Installer execution uses Node child_process; it no longer imports Durable. Existing skill-link ownership protection and update-only OpenTUI remain.
- No user databases, credentials, native sessions or worktrees were deleted. No legacy-state migration is included in the replacement.
- Native Pi dependency remains `@earendil-works/pi-coding-agent@1.4.0`. Required public SDK compatibility must be checked in Design before choosing implementation syntax. No SDK/runtime upgrade is authorized by discovery.

Cleanup evidence: offline local dependency pruning, `pnpm exec oxlint --fix`, `pnpm exec oxfmt`, `pnpm run check` and strict lint passed. Seven native-launcher/installer tests passed. This proves the cleaned baseline, not any new Durable role.

## Deferred references, not implementation scope

- 22 background subagents and 19 inbox: future parallel/background interaction.
- 28 per-conversation environment: future multiple-worktree assignment, not automatic Git worktree creation or a security sandbox.
- 33 turn-limit/continue, 24 compaction and 32 tests-after-edits: consider only when their need and installed API support are established.
- 02 forks, 20 late join, 31 transcript and 30 reload/restart: optional future capabilities, not new UI requirements.
- 35–37 store/registry/view infrastructure: not needed for this scope.

## Known versus unresolved

Existing decisions: native Pi is the sole orchestrator; three roles only; existing spec approval workflow; external remote-session management; example-first implementation.

Sourced facts: the four examples above and the cleaned repository baseline. Prior implementation/recovery-test results do not certify a new implementation.

Design questions: smallest native-Pi invocation, role/session selection and safe storage lifecycle using public APIs. Resolve these within the approved scope at Design; stop if they require extra infrastructure or a dependency upgrade.

No product-scope decision is left open by discovery. Requirements approval is the next gate. No replacement application code may be written during this spec workflow.
