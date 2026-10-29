# Implementation Plan: example-based Durable core roles

## Inputs

- Specification: [spec.md](spec.md), SHA-256 `094b367f8db6208c74fd2100dcac22f7c91ef46644500829c0d556789c8fd1eb`.
- Requirements approved through Plannotator `pn-384c21`; Technical Design approved through `pn-d12919`.
- [Research and example map](research.md); [review history](reviews.md).
- Core references: examples 26 (planner), 25 (coding), 27 (reviewer) and 12 (persistence), at the source snapshot recorded in the specification.
- This plan is for review. V1–V7 are expected evidence, not new-role checks already executed. Planning approval alone does not start implementation.

Before the first edit, revalidate the artifact hashes/decision references and inspect current repository instructions, branch, HEAD and staged/unstaged/untracked changes. Preserve the dirty checkout and record its exact starting state in a private receipt location. The cleanup baseline passed seven tests and repository checks, but it is not proof of the new roles. Recheck rather than assuming it remains unchanged.

The intended implementation has only two new responsibilities: a native-Pi extension entry and direct SDK role composition. Suggested paths are `packages/pi-runner/src/roles-extension.ts` and `src/roles.ts`; colocate small helpers rather than creating a role framework. Use the existing package manifest/launcher and skills for integration. Do not restore `src/durable/`, the deleted command layer or old spec.

## Execution graph

```text
T1 — working read-only planner and saved role state
 └── T2 — explicitly approved coding role
      └── T3 — separate read-only reviewer
           └── T4 — complete native workflow, docs and final evidence
```

One writer is sufficient. Do not delegate, create worktrees, change branches or run paid models/global installs without separate authority. Verify each increment before starting its dependent task.

### T1 — Deliver the planner from example 26

- **Requirements:** R1, R2, R3, R6, R7, R8.
- **Design:** D1, D2, D3, D4.
- **Depends on:** None.
- **Affected area:** Native extension entry, SDK role module, runner manifest/dependencies, planner/spec routing in `skills/dev/kriscard-mode`, focused role tests.
- **Implementation boundary:** Add the public-API SDK composition needed for the planner, without reusing deleted code. Register `durable_plan` through the existing native package-loading path with native sequential execution. Keep 26's SDK plan document, read/submit tools and prompt section. Use 12's SQLite pattern with one private role root per saved native session. Open lazily; close/join and clean up on native shutdown/replacement. Implement explicit new-task versus resume behavior without an application job ledger. Use public Pi model/configuration APIs, explicit cwd and readable native results. Direct imports may require restoring compatible SDK dependencies; do not upgrade the existing 1.4.0 family or global tooling. Leave coding/reviewer tools unregistered until their increments.
- **Validation:** **V1/V2** — from actual native Pi, invoke planning through Kriscard Mode, receive a proposal/question and show that write/shell tools are unavailable and project hashes are unchanged. **V5** — close/reopen the saved native session and recover the same draft/history without duplicate assignment; distinguish explicit cancellation from interrupted work. **V6** — exercise selected model/project, unavailable configuration, inaccessible ticket input, unsaved-session rejection and current unanswered/error results. Run `pnpm run build`, `pnpm --filter @kriscard/kstack exec node --test test/roles.test.mjs`, then `pnpm run typecheck`.
- **Expected result:** One usable planning role in normal native Pi. Native Pi still owns spec-file writing and approval. State persists through SDK storage; no server, shell job commands, receipt UX or second coordinator appears. The role test is a focused existing-runner suite, not a new platform.
- **Deviation stop:** Private SDK/native APIs, incompatible package-family requirements, a provider adapter framework, extra persistence/mapping infrastructure or a change to native-Pi ownership is needed. Report the specific mismatch and return to Design before taking that action.

### T2 — Add the approved implementer from example 25

- **Requirements:** R1, R2, R4, R6, R7, R8.
- **Design:** D1, D2, D3, D4.
- **Depends on:** T1, including its native planner and persistence checks.
- **Affected area:** The same native entry/SDK role files, implementation routing/playbook instructions and focused role tests.
- **Implementation boundary:** Add `durable_implement` using CodingTools and the conversation's explicit project/model configuration. Reuse the lifecycle/storage/result handling already justified in T1; avoid separate controller classes or executors. Native Pi applies the existing implementation workflow and supplies the accepted task/spec. Use Pi's existing confirmation dialog before either starting coding or resuming its unfinished work. Declined/cancelled/unavailable confirmation starts no coding. Native cancellation aborts and joins that role through the SDK; it does not merely cancel the waiter. Keep questions/deviations in native Pi. Add no delegation, automatic worktree management or test/fix loop.
- **Validation:** **V3** — actual native calls with accepted versus declined/cancelled confirmation, an approved fixture edit and a planning-only request. Check intended file changes and returned command evidence. **V5/V6** — preserved conversation after cancellation/reopen, recovery of uncancelled interrupted work, truthful failure and explicit model override versus an unavailable saved model. Run `pnpm run build`, the focused `test/roles.test.mjs` command and `pnpm run typecheck`.
- **Expected result:** An explicitly approved task can change the fixture using standard SDK tools and return its actual outcome. Missing approval or a deviation does not silently become implementation. No unattended approval path or duplicate workflow authority is added.
- **Deviation stop:** Another approval database/parser framework, autonomous workflow/repair loop, extra execution host or broader role scope is proposed. Keep valid planner work and return to the owning planning gate.

### T3 — Add the read-only reviewer from example 27

- **Requirements:** R1, R2, R5, R6, R7, R8.
- **Design:** D1, D2, D3, D4.
- **Depends on:** T2.
- **Affected area:** The same native entry/SDK role files, review routing/playbook instructions and focused role tests.
- **Implementation boundary:** Add `durable_review` with its own SDK conversation/storage root, explicit review section/model/cwd and read-only tool selection. Reuse the established lifecycle/model/result path. Follow 27's reviewer configuration, but omit its automatic stop-phrase repetition as the approved design requires. Another review pass is a new explicit request. Return findings or an evidence-backed no-findings answer; native Pi owns adjudication and any subsequent repair request.
- **Validation:** **V4** — review a controlled fixture defect and a clean fixture; verify the reviewer cannot call write/shell tools and project hashes remain unchanged. Verify separation from the implementer's conversation and an explicit second pass without automatic repair/repetition. **V5/V6** — reopen reviewer state, exercise an explicit configured model and report current failures rather than a prior verdict. Run `pnpm run build`, the focused role tests and `pnpm run typecheck`.
- **Expected result:** Native Pi receives a separate role's findings through ordinary tool output. No hidden writer, approval authority, background reporter or review/fix service is introduced.
- **Deviation stop:** Review requires write-capable tools, an autonomous model coordinator, unbounded continuation or new background machinery. Report the gap rather than expanding the role.

### T4 — Verify and document the complete native-Pi workflow

- **Requirements:** R1–R8.
- **Design:** D1–D4.
- **Depends on:** T3.
- **Affected area:** Root/package README, `CLAUDE.md`, the existing mode/orchestration/review instructions, final focused tests and private verification receipts.
- **Implementation boundary:** Reconcile descriptions with the three actual tools, confirmation/resume behavior, role state ownership and configuration limits. Replace the cleanup-era capability-unavailable notice only with behavior now implemented and verified. Keep background agents, SSH/session management and other examples deferred. Do not restore old worker contracts, IDs/receipt commands or legacy compatibility code. Inspect the complete diff against the starting state and example map, including dependencies and preserved installer/link work.
- **Validation:** **V1–V6** — perform one actual native-Pi journey: prompt or controlled ticket intake → planner proposal/question → existing spec/user gates → confirmed fixture implementation → read-only review. Exercise saved-session reopen and representative failure/cancellation paths. A shell proxy or direct SDK test alone does not satisfy the native journey. **V7** — run all repository checks below, compare code with examples 26/25/27/12 and verify excluded mechanisms are absent. Retain exact commands, outcomes, runtime/package versions and the final tree/snapshot identity; rerun affected evidence after repairs.
- **Expected result:** All eight requirements have observed evidence or a clearly named gap. Native UI/extensions, updater and skill-link safeguards remain intact. The implementation is recognizable as the official examples plus necessary native-Pi invocation, not a platform. No commit, push or release is part of completion.
- **Deviation stop:** Missing required native behavior, scope drift, unresolved failures or extra infrastructure is necessary. Report partial/blocked rather than certify readiness or silently rewrite this plan.

## Traceability

| Requirement                         | Design | Tasks  | Expected evidence                 |
| ----------------------------------- | ------ | ------ | --------------------------------- |
| R1 — Native Pi orchestrator         | D1     | T1–T4  | V1, V7                            |
| R2 — Bounded existing intake        | D1, D4 | T1–T4  | V1, V6                            |
| R3 — Read-only planning             | D2     | T1, T4 | V2, V5                            |
| R4 — Approved implementation        | D2, D4 | T2, T4 | V3, V6                            |
| R5 — Separate read-only review      | D2     | T3, T4 | V4, V6                            |
| R6 — SDK persistence/recovery       | D3, D4 | T1–T4  | V5, V6                            |
| R7 — Intended configuration/project | D4     | T1–T4  | V6                                |
| R8 — Example-sized responsibility   | D1–D4  | T1–T4  | V7 plus source/example comparison |

## Repository-wide validation

After code changes, follow repository instructions and run:

```bash
pnpm exec oxlint --fix
pnpm exec oxfmt
pnpm run check
pnpm exec oxlint --deny-warnings --format=agent
```

`check` covers lint, build, tests, typecheck and formatting. Keep the existing native-launcher and installer tests. Add only focused role coverage, using the official examples' controlled-model pattern with real SDK tool/storage boundaries. Inspect automatic formatting/fix changes for unrelated edits; never reset whole files or change approved spec hashes as an implementation shortcut.

These commands are expected implementation evidence, not checks already run for new role code. No paid-model requests, user-global installation, dependency upgrades or broad verification framework are implied.

## Rollout and documentation

- Ship the working planner before adding coding/review. Use disposable projects and private temporary role state during verification.
- Explain new-task versus resume, explicit coding confirmation, the selected project/model and current-role errors in ordinary native Pi output. Do not introduce another command interface.
- Explain that one saved native session owns its private role files and supports one active native Pi process. External SSH/Mosh/terminal session persistence is not Kstack functionality.
- New native sessions start separate role state. Unsaved sessions cannot promise persisted role recovery. Do not silently move a reopened role to another project or substitute a saved model.
- No old-database migration is performed. Preserve old user data; do not install legacy anchor/reporter definitions.
- Rollback disables/removes the new native extension while retaining role files and native JSONL. Completed tool effects are not undone. Any later incompatible storage change requires separate approval and a backup/migration decision.
- Hand back changed paths, example mapping, exact-state evidence and limitations. Follow the implementation skill's review/authority rules; independent reviewers, paid calls, commits and remote actions require their applicable authorization.

## Risks and deviation stops

- A native skill is not executable SDK integration; prove the actual extension/tool path rather than claiming the instructions alone run a role.
- A submitted draft is not an approved spec. Keep spec approval and implementation action confirmation distinct and owned by their existing workflow/native UI.
- Read-only is actual tool selection, not only a prompt. Native permission extensions do not automatically sandbox SDK tools.
- Persistence is recovery, not continuous execution without a live process. SDK cancellation, close and unsafe effects must remain distinguishable.
- The current `main` examples can differ from the compatible installed SDK. Check public contracts; stop before an unapproved upgrade, private import or adapter framework.
- User data and unrelated working-tree changes remain protected. Deleted code, old specs and their verification results are not implementation shortcuts.
- Examples 19/22/28 and all other deferred features have no tasks in this plan. Adding them requires a later approved scope.
