# Spec: example-based Durable core roles

## Source context

The user requested a fresh start: delete the previous Durable implementation, follow the official SDK examples and begin with three roles—planner, implementer and reviewer. Other capabilities come later. Native Pi, launched through Kstack with Kriscard Mode, remains the orchestrator. SSH/Mosh and terminal-session persistence are outside Kstack.

Authoritative references are [26 plan mode](https://github.com/earendil-works/pi/blob/e7a0df27c09d11bf4161d3605246cbf57a129cb2/packages/durable/test/examples/26-plan-mode.ts), [25 coding agent](https://github.com/earendil-works/pi/blob/e7a0df27c09d11bf4161d3605246cbf57a129cb2/packages/durable/test/examples/25-coding-agent.ts), [27 reviewer](https://github.com/earendil-works/pi/blob/e7a0df27c09d11bf4161d3605246cbf57a129cb2/packages/durable/test/examples/27-reviewer.ts) and [12 recovery](https://github.com/earendil-works/pi/blob/e7a0df27c09d11bf4161d3605246cbf57a129cb2/packages/durable/test/examples/12-recovery.ts). [Discovery](research.md) records their limits and the cleaned baseline.

Relevant areas: `packages/pi-runner/src/launcher.ts`, `src/cli.ts`, the bundled `kriscard-mode` skill and its planning/implementation/review playbooks. The old worker implementation and old spec are removed; neither is the new design's starting point.

Requirements approved in `pn-384c21`. Design/plan decisions and final certification are recorded separately as each gate completes. This workflow is planning only.

## Requirements

### Summary and problem

Provide three useful SDK roles in the normal native-Pi workflow, without turning Kstack into an agent framework. Each role should be understandable by comparison with its official example. Native Pi selects the role, supplies bounded context, presents its answer and handles user decisions.

The first delivery is deliberately sequential: get planning working, then implementation and review. It is not the previous background-agent system under new names.

### Users and outcomes

A developer starts Kstack, describes work or supplies a ticket, discusses a proposed spec in native Pi, approves it and requests implementation and review. The developer can revisit saved role conversations after reopening the runtime. They do not manage worker IDs, JSON receipts, servers or a second coordinating conversation.

### Scope

- Preserve the native-Pi launch and default Kriscard Mode entry point.
- Planner role based on example 26, implementer based on 25 and reviewer based on 27.
- Persistent role state and SDK close/reopen behavior based on example 12.
- Only the native-Pi integration and configuration access necessary to invoke those roles and return their answers.
- Existing spec artifacts and user-approval workflow remain the authority for accepted work.

### Non-goals

- Background/parallel agents, example 22 orchestration, automatic idle notifications and user-question routing from unattended agents.
- Automatic worktree creation, panes, terminal multiplexers, SSH/Mosh management or moving a live agent between machines.
- Custom sockets, HTTP/RPC servers, a detached daemon, public JSON job commands, receipt-management UX or a replacement Pi UI.
- Another scheduler, task database, queue, retry engine, role framework or autonomous model coordinator.
- Automatic reviewer-to-fixer loops, test-after-edit automation, new conversation viewers or other optional example features.
- Reusing the deleted integration, migrating its saved records, deleting old user data or changing the updater.
- New ticket connectors, credential stores, runtime enforcement, global tooling changes or unapproved SDK upgrades.

### Constraints

- Each implemented responsibility must map to one of the four cited examples or explain the minimal native-Pi integration it requires. Use public SDK behavior rather than recreating it.
- Example code under live `main` is not proof of installed API compatibility. Resolve compatibility during Technical Design; stop rather than silently upgrade or invent wrappers.
- Native Pi owns its UI, native history, workflow and human interaction. Durable owns role conversation/task state. No transcript copying or history conversion is required.
- A running process is necessary for execution. External session management may keep native Pi running after SSH disconnect; Kstack supplies no independent process-lifetime guarantee.
- Role tool selection is real: a read-only instruction alone is not the planner/reviewer's restriction. Local coding tools are not a security sandbox.
- Preserve unrelated dirty-tree work, installer/link safeguards, update-only OpenTUI, native sessions, credentials and user data.
- Deliver each role in a small verified increment. Do not add scaffolding for the deferred examples.

### Observable requirements

#### R1 — Native Pi remains the orchestrator

Starting Kstack opens normal native Pi and loads Kriscard Mode. Native Pi selects the requested role and receives its answer in the same user workflow. The user does not switch to another interface or communicate with another coordinating agent.

**Acceptance:** From an actual native-Pi session, invoke a role and continue the discussion using normal Pi controls. Existing native arguments, configured extensions and session behavior still work. No replacement UI or worker-command/receipt workflow is required.

#### R2 — Existing intake supplies bounded role context

Native Pi accepts a prompt or retrieves a referenced ticket using already available integrations. It supplies the selected role with the relevant request, project directory, approved artifacts and questions—not the entire parent transcript.

**Acceptance:** Exercise prompt intake and an available ticket integration or controlled equivalent. Missing access yields an explicit request for the source, not invented ticket content or a new connector. Role context identifies the intended project and task.

#### R3 — The planner proposes without editing project files

The planner follows example 26: inspect with read-only tools and submit a draft plan into SDK-owned state. It returns proposed work and unresolved questions to native Pi. Native Pi owns discussion, spec-file presentation and approval gates; a submitted SDK plan is not permission to implement.

**Acceptance:** A controlled planning request yields a retrievable proposal while project-file hashes remain unchanged. Edit/shell execution tools are unavailable to that role. Native Pi can present the proposal through the existing spec workflow, ask the user a question and stop before any implementation. No automatic creation of an approved certificate is claimed.

#### R4 — The implementer executes only approved work

On an explicit implementation request, native Pi supplies the accepted spec/task to a coding role using the standard tools and selected directory from example 25. The role returns what changed, actual checks and any blocker.

**Acceptance:** An approved fixture task changes its intended file and reports executable evidence. A planning-only request never starts this role. Missing approval or a consequential deviation returns to the native orchestrator rather than expanding the task or silently changing the spec.

#### R5 — The reviewer is a separate read-only role

The reviewer follows example 27: its own conversation, explicit review instructions/model selection, selected project directory and read-only tools. It reports findings and evidence to native Pi; it does not edit files, approve its own findings for repair or trigger an automatic repair loop.

**Acceptance:** Reviewing a fixture change produces findings or an evidence-backed no-findings answer, with project hashes unchanged. The reviewer cannot invoke edit or shell tools. Native Pi presents the result for the next user/workflow decision. Any repeat pass is explicit and terminable, not an unbounded stop-phrase loop.

#### R6 — Role state survives close and reopen

SDK role conversation state and the submitted draft plan use persistent storage following example 12. Reopening the selected storage makes the saved conversation/proposal available without recreating it.

**Acceptance:** Run a controlled role interaction, close the runtime and reopen the same storage. Recover its history and submitted plan through SDK records. Interrupted work follows the SDK's safe/unsafe recovery rules; errors remain errors. No continuous execution is claimed while the host process is absent, and no native JSONL conversion occurs.

#### R7 — Roles use the intended model and project

Roles reuse existing Pi model access/configuration and receive an explicit project directory. They do not require a separate login or silently substitute an unavailable saved model. Reviewer model selection may differ when explicitly configured.

**Acceptance:** Invoke controlled roles using the configured model access and selected fixture directory. Verify the role receives that project's instructions/context. Missing configuration returns an actionable failure. This does not claim arbitrary native extension factories or permission hooks automatically apply inside Durable tools.

#### R8 — The result remains example-sized in responsibility

The new implementation exposes the three roles, not a general agent-control platform. Its review must account for each added responsibility against the cited examples or necessary native-Pi glue. SDK-internal IDs may exist but the user is not required to manage a custom job/receipt protocol.

**Acceptance:** Compare the final code and actual native-Pi journey with the example map. Confirm there is no custom server/transport, detached host, second coordinator, duplicated task machinery or implementation of deferred examples. Existing updater, native launch and ownership-protection tests remain passing. Added complexity without a current role requirement blocks acceptance.

### Edge cases and failure expectations

- An inaccessible ticket is missing input, not permission to invent details.
- Planner proposals are drafts until the existing user gates accept them.
- Role failure, cancellation or unavailable configuration must not return an older successful answer as the current result.
- Reopening persistent state is recovery, not execution without a process. SSH continuity belongs to external session management.
- Native session changes and SDK storage have distinct ownership; do not silently erase either history.
- Old Durable databases remain untouched. No legacy registry/task compatibility layer is required for this fresh implementation.
- If the examples cannot support a required behavior through the available public APIs, report the limitation before adding a mechanism.

### Acceptance criteria

R1–R8 each contain an observable pass/fail criterion. Verification must include real native-Pi invocation, role tool restrictions, actual fixture files and persistent SDK storage—not only mocked function calls. Controlled SDK models are appropriate; paid model requests and user-global installations require separate authority.

Repository lint, build, tests, typecheck and formatting checks must pass on the final implementation. Formatting the planning artifacts before certification is part of this spec workflow. No new test framework or broad platform harness is required.

### Open product decisions

None at Requirements: three roles now; background orchestration and other examples later. The smallest native-Pi entry point and public SDK composition remain Technical Design questions. Any need for additional infrastructure, changed behavior or dependency upgrades returns to the owning approval gate.

## Technical Design

### Current-system evidence

The cleaned runner launches native Pi and loads its package through the existing `--extension` package argument. Its manifest currently declares skills only. Native Pi 1.4.0 publicly supports package extensions, `registerTool()`, sequential tool execution, confirmation dialogs, native session identity and `session_shutdown`.

The public Durable 1.4.0 declarations support the four reference examples' core mechanisms: registry/extensions, selected tools, conversation agent configuration, submissions, SDK documents, NodeExecutionEnv and SQLite close/reopen. Reintroducing the required direct SDK dependencies during implementation is ordinary application composition, not a runtime upgrade or revival of deleted code.

Native Pi's `ctx.modelRegistry` is a compatibility facade, **not** the SDK `Models` interface. Do not cast it to Models or access its private runtime. Public `ModelRuntime` and provider-registration APIs provide the supported configuration path.

### Components and responsibilities

```text
native Pi + Kriscard Mode
  └── ordinary native role-tool call
        ├── planner: example 26
        ├── implementer: example 25
        └── reviewer: example 27
              └── SDK SQLite persistence: example 12
```

Keep two small implementation responsibilities:

- **Native extension:** register the three role tools, take project/session/model context from Pi, enforce native tool sequencing and coding confirmation, and present the result using Pi's normal tool output. No custom renderer.
- **SDK role composition:** define the planner/reviewer extensions, select each role's tools, open its SDK conversation and return that call's outcome. Use SDK records and lifecycle directly.

The existing launcher/package manifest loads the extension; skills explain when to invoke each role. There is no executable orchestration service, background parent agent, command client, transport or general-purpose role framework.

### Interfaces and normal flow

Register `durable_plan`, `durable_implement` and `durable_review` as native Pi tools. Each accepts either a bounded new `task` or `resume: true`, plus an optional explicit SDK model reference for a new assignment (`provider`, `modelId`). The project comes from native Pi's current cwd, not a new worktree manager. Set each tool's existing native `executionMode` to `sequential`; do not implement a queue.

1. Native Pi performs intake with existing tools/skills. It resolves ticket access and consequential questions before sending a task. Ticket URLs and retrieved text are task data, not executable instructions or connectors in the role module.
2. The selected native tool obtains the saved native session identity and lazily opens that role's SDK state. Ordinary Kstack startup creates no Harness.
3. For a new task, select the role's SDK agent, submit the request and await **that submission**, not global idle or another agent's report. If the reopened role has unfinished inputs, return a resume-needed message before enabling SDK scheduling. For `resume: true`, reacquire the unfinished submission from SDK inspection and await it instead of resubmitting the assignment.
4. Read the SDK's settled submission and its answer entry. Return readable text through native Pi's standard tool result. SDK conversation/submission IDs stay internal; there is no receipt UX or public job API.
5. Native Pi discusses the response, asks the user questions and performs the existing workflow's document-writing/approval steps.

For implementation, native Pi first applies the existing implementation workflow to the approved task/spec. The tool uses Pi's built-in confirmation dialog before starting the code-capable role, showing the task, project and model. Declining, cancelling or lacking a confirmation-capable UI does not start it. This is an action gate, not a second spec-approval ledger. Ordinary native print mode remains usable; unattended approval of the coding role is not supplied by this slice.

### Role definitions: retain the examples, omit extras

| Role        | SDK composition                                                                                               | Deliberately not added                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Planner     | Example 26's plan document, submit-plan tool, prompt section and explicit read/submit tool selection          | Filesystem writes, shell, a new spec schema or automatic approval                      |
| Implementer | Example 25's CodingTools, explicit model/settings and project-scoped NodeExecutionEnv                         | Delegation, worktree creation, test/fix automation or workflow policy loops            |
| Reviewer    | Example 27's review section, explicit agent model/cwd and read-only tool selection in a separate conversation | The demo's automatic stop-phrase repetition; another pass requires an explicit request |

If there is no unfinished submission, an explicit resume returns the saved draft/history clearly labeled as historical, not as a newly completed run. Include failed entries rather than substituting an older successful answer. No application receipt or completion record is persisted.

The SDK plan document is working draft state. It does not replace `spec.md`, `plan.md` or `approval.md`. The planner may return clarification questions before a proposal is complete. Native Pi owns the canonical artifacts and their gates; submitting a plan never enables implementation automatically.

Each task includes relevant project instructions and approved artifact references through the existing native workflow. Roles read applicable project files with their selected tools. Do not copy the complete native transcript/system prompt or add a resource watcher/cache.

### Persistence and lifecycle

Use **one private SQLite file per role per saved native session** under the Pi agent directory, keyed by the native session identity and fixed role name. Each file uses its SDK root conversation. This avoids a new name-to-conversation document, application job table or restoration index. The three roles remain separate conversations; none coordinates the others.

Only the used roles are opened. Keep their live SDK handles in the native extension's lifetime; those handles are disposable resources, not another persistence authority. On `session_shutdown` (quit, reload or session replacement), close/join the open Harnesses and clean up their execution environments before discarding the handles. A later invocation in the same saved native session reopens the same role file and SDK root.

No native JSONL is rewritten or imported. New native sessions receive separate role state. Unsaved native sessions return an actionable persistence requirement rather than silently using memory-only state. Reopening a saved role in a different project must not silently relocate its existing conversation.

The SDK requires a single live owner of each storage. This slice supports one active native Pi process for a saved session; it does not support opening that same session concurrently in multiple Pi processes. Reattach externally to the existing terminal session instead. Do not add a process-lock protocol, daemon or multi-client service to expand that contract.

### Models and project environment

Use the coding-agent package's public `ModelRuntime.create()` to access existing Pi configuration and credential files. Reuse a selected native provider registration through public registry/runtime registration APIs where necessary; do not load native extension factories into SDK tool registries or create a provider adapter framework. Missing model/auth support is an explicit error, never a fallback to the first available model.

A new role starts with the native selected model unless the caller explicitly supplies another configured model. Reopened roles retain their saved model unless an explicit override is supplied. Preserve that distinction in tool descriptions/results; do not silently change an unavailable saved model.

The role's SDK agent receives the native project cwd. Its NodeExecutionEnv follows that directory, as in example 25, and is cleaned up after its Harness joins. Reuse public SDK execution and cancellation rather than custom subprocess/process-group management. Native extension permission hooks are not claimed to guard SDK coding tools.

### Failure, cancellation and recovery

- Return the current submission's unanswered/error reason as a native tool error. Never read an older answer as a substitute, parse a success phrase or create an application outcome ledger.
- Cancelling the native role call explicitly aborts that role's current SDK work using the conversation API; cancelling only `Submission.wait()` would leave work running. Join the abort before returning cancellation. Preserve the conversation and report possible partial effects.
- Session shutdown closes SDK resources. If native Pi already cancelled an active tool, that committed cancellation remains cancelled; shutdown must not turn it back into resumable work. Uncancelled saved state and recovery after abrupt process loss follow the SDK, as in example 12. No always-running service or survival of a native cancellation is promised.
- Storage/configuration failures are reported and preserved for diagnosis. Do not reset databases, replay unsafe operations or silently select a different model.
- Role questions and findings return through the current call. Automatic idle-session notifications and background-agent question routing remain deferred.

### Security, compatibility and operations

This remains trusted local execution with user permissions. Planner/reviewer restrictions come from actual SDK tool selection; they do not sandbox files or defend against a malicious local user. Use private directories/files for transcripts and SDK state. Do not log credentials or full prompts as a second journal. Validate native inputs and session-derived storage identity at their boundaries.

Keep native Pi 1.4.0 and the compatible 1.4.0 SDK family as the implementation compatibility boundary. Add only direct packages required by the public imports. The reference snapshot is a guide, not permission to upgrade the SDK, Node or global tools. If a required API differs materially, return to this gate rather than add a compatibility wrapper.

There is no migration from the deleted integration and no registration of its anchor/reporter tasks. Leave old user data untouched; use the new role-state namespace only. Roll out by proving planning first, then coding and review. Rollback disables/removes the native role extension while retaining role files; it never undoes completed coding effects or rewrites native history.

Native tool output and existing SDK conversation state are sufficient observability. No dashboard, worker panels, health endpoint, CLI control commands or new logging/monitoring system is included.

### Design decisions

#### D1 — One native extension, no second orchestrator

- Requirements: R1, R2, R8.
- Decision: Existing native package loading registers three ordinary sequential tools. Native Pi and skills keep workflow ownership.
- Evidence: Current launcher/manifest and native `registerTool`/`executionMode` contracts; SDK examples are not native-Pi plugins by themselves.
- Trade-off: Small necessary API glue, but no background delivery or new interface.
- Reversal: Disable the package extension without replacing native Pi or deleting its history.

#### D2 — Direct example-based role composition

- Requirements: R3, R4, R5, R8.
- Decision: Keep 26's planner, 25's coding tools and 27's read-only reviewer configuration. Use the native confirmation UI for coding and explicit requests for repeat review.
- Evidence: The three role examples and approved workflow/approval boundaries.
- Trade-off: No automatic review/repair cycle; human decisions remain in native Pi.
- Reversal: Change a role's explicit tool selection/configuration without adding a role engine or changing canonical spec ownership.

#### D3 — SDK persistence inside the native process

- Requirements: R6, R8.
- Decision: Lazy role-specific SQLite roots for each saved native session, with SDK close/reopen and native lifecycle hooks.
- Evidence: Example 12 and public session identity/shutdown APIs. Fixed role files avoid a new registry/document mapping.
- Trade-off: One active native process per saved session, no unsaved-session persistence and no execution after that process exits.
- Reversal: Retain the role files when disabling the extension; no native history conversion or legacy migration.

#### D4 — Public configuration and outcome APIs only

- Requirements: R2, R4, R6, R7, R8.
- Decision: Use public Pi model/configuration access, explicit cwd, SDK submissions/answer entries and SDK abort/close semantics.
- Evidence: Native ModelRegistry is not Models; ModelRuntime/provider registration and Durable lifecycle APIs are public. Examples 25/27 use explicit agent choices.
- Trade-off: Unavailable configuration is surfaced instead of hidden by another provider/model or adapter.
- Reversal: Adjust the small integration at its public API boundary; never add private imports, duplicate recovery or modify saved user data as a workaround.

### Expected verification and blockers

Use existing node:test conventions, controlled SDK models, real temporary files and SQLite. Keep fixtures proportional to the three roles; no new test platform or production test flags.

| Evidence                               | Requirements   | Observable boundary                                                                                                                      |
| -------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| V1 — Native role invocation            | R1, R2, R8     | Actual native Pi loads the extension, calls a role and receives ordinary tool output without a second coordinator                        |
| V2 — Planner restrictions and proposal | R3             | Attempted write/shell use is unavailable; project hashes are unchanged; the SDK draft is returned for native spec discussion             |
| V3 — Approved coding                   | R4             | Native confirmation accepted versus declined/cancelled; only the approved fixture task runs                                              |
| V4 — Read-only review                  | R5             | Separate reviewer conversation, actual tool restrictions and unchanged project hashes; no automatic fix/repeat loop                      |
| V5 — SDK persistence/recovery          | R6             | Close/reopen the same role storage and recover proposal/history; distinguish explicit abort from uncancelled interrupted work            |
| V6 — Configuration and failure paths   | R2, R4, R6, R7 | Selected model/project, inaccessible input, missing configuration, cancellation and unanswered submissions yield truthful native results |
| V7 — Preservation and simplicity       | R1, R8         | Repository checks plus source/example comparison; native launch/updater safeguards stay intact and excluded infrastructure is absent     |

These are future implementation checks, not results already obtained for the roles. Controlled models do not authorize paid requests or user-global installation.

No product/design blocker is hidden here. Implementation must stop if the required public API composition needs additional infrastructure, unsupported provider adaptation, changed scope or a dependency upgrade. Design approval precedes `plan.md`; no replacement role code is authorized by this document.
