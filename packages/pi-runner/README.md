# @kriscard/kstack

Native Pi with Kriscard Mode, workflow skills and three example-based Durable roles.

```bash
kstack
kstack run "Propose a fix for the failing checkout test without editing files"
kstack --continue
```

Pi owns its UI, extensions, workflow and JSONL session. `kstack pi` uses the same frontend;
`kriscard` aliases `kstack`. Roles run inside that Pi process, not a daemon or second coordinator.

## Role tools

Ask normally in native Pi; its model invokes these tools with bounded context:

| Native tool         | Responsibility                                                                   | Official example |
| ------------------- | -------------------------------------------------------------------------------- | ---------------- |
| `durable_plan`      | Read project files and submit a draft SDK plan or clarification questions        | 26 plan mode     |
| `durable_implement` | Use CodingTools only for the accepted task, after native user confirmation       | 25 coding agent  |
| `durable_review`    | Separate conversation/model, read-only findings; repeat only on explicit request | 27 reviewer      |

The source snapshot and approved scope are in [the core-role spec](../../docs/specs/durable-core-roles/spec.md).
The SDK family is 1.4.0; example numbering can differ in that release's README.

`src/roles.ts` composes the SDK roles, documents, tools, submissions and SQLite recovery from example 12. `src/roles-extension.ts` supplies native tool registration, model/configuration access,
confirmation, cancellation and resource lifecycle. There is no application scheduler, job database,
transport, command client, repair loop or SDK coordinating agent.

Native Pi performs intake, applies installed workflows, resolves ticket access and supplies relevant
instructions/artifact references—not its full transcript. It writes canonical spec documents and
owns approval. An SDK draft does not create an approved certificate or enable coding. Roles read
applicable AGENTS.md and task-provided instructions; generic skills remain separately owned.

## Models, confirmation and saved state

- New roles default to the native selected model. An explicit configured model can be supplied for
  a new assignment. Saved roles keep their own model; unavailable choices fail rather than falling
  back. Existing Pi model configuration/credentials are reused through public APIs; no second login.
- Planning/review use actual read-only SDK tool selections. This is not a filesystem sandbox.
- Coding uses trusted local SDK tools with user permissions. Pi's confirmation dialog shows task,
  project and model before new or resumed coding. Declining/cancelling starts no coding. Interactive
  Pi and confirmation-capable RPC clients support it; unattended print/JSON approval is unavailable.
  Native permission extensions do not automatically guard tools running inside the SDK.
- Each saved native session uses private files under
  `$PI_CODING_AGENT_DIR/durable-core-roles/<native-session>/<role>.sqlite` (default agent directory:
  `~/.pi/agent`). Only invoked roles open. Unsaved sessions return a persistence requirement.
- Ask native Pi to resume a role: it invokes the same tool with `resume: true`, without a task or
  model override. Unfinished SDK submissions resume without resubmitting the assignment. Otherwise
  saved draft/history is labeled historical, including failed entries; it is not a new success.
- A new task is rejected while that role has unfinished saved input. Native cancellation aborts and
  joins the SDK work, preserves history and reports possible partial effects. It does not roll back
  completed edits. Close/reopen and interrupted unsafe effects follow SDK recovery rules.
- Use one active native Pi process for each saved native session. Reattach to its terminal externally;
  concurrent opening of the same role storage is unsupported. Session changes/shutdown close SDK
  resources. A saved role is not silently moved to another project.

Execution requires the Pi process. SSH/Mosh continuity and terminal multiplexers are external.
There are no background notifications, automatic worktrees, parallel workers or reviewer/fixer loops.
The removed worker commands/data formats are not restored or migrated; old user data stays untouched.
To roll back, disable/remove the role extension and retain its files. Native JSONL is never converted.

## Verification

The existing node:test suite uses controlled SDK models, real files and SQLite, and actual native Pi
through Kstack. It covers tool restrictions, native confirmations, bounded context, current failures,
explicit models, partial/unsafe recovery and a plan → approve → implement → review → reopen journey.
Approval in these disposable fixtures is a controlled user action, not fabricated product approval or
proof of real-provider reasoning quality. No paid calls or global installs are made by the tests.

See the [repository README](../../README.md) for setup, update-only Soft Glow, ownership safeguards
and repository checks. Custom `KSTACK_MODE_PATH` skill-only fallback retains its existing behavior;
load the package extension explicitly if that custom setup needs these role tools.
