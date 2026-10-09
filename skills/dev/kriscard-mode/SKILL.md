---
name: kriscard-mode
description: >-
  Route engineering work through Kriscard Stack when the user enables Kriscard mode
  or asks for its feature, bug-fix, refactor, migration, investigation, review,
  release, or multi-ticket orchestration workflow.
---

# Kriscard Mode

Select one outcome playbook, state its side-effect class, and carry approved work through explicit owners to human-controlled landing. General-purpose methods remain in the compatible `kriscard/Skills` collection.

## 1. Establish available capability

Classify capabilities from evidence, not package names or intended architecture:

- **Durable mode:** a reachable control plane actually provides the requested durable operation.
- **Plain-skills mode:** the product and general skills are available in the current host without that durable operation.

Plain-skills mode can route, perform read-only work, prepare `/spec`, and execute an approved task manually when a capable owner and the required permission are present. It cannot claim automatic frontier scheduling, crash-safe worker launch or recovery, durable leases, or independent verification that did not occur. A terminal, background process, or chat transcript is not a durable substitute.

Check a named skill or runtime capability when its stage is reached. A missing dependency blocks that stage, not unrelated completed stages or all future work. Report the failed stage, preserved state, safe options, and the concrete capability needed. Resume from valid approved evidence when the capability becomes available; never imitate a missing skill's contract silently.

**Complete when:** the next requested stage has a named available owner, or one precise capability blocker is reported without overstating its scope.

## 2. Classify the requested outcome

Use the terminal outcome rather than isolated nouns. Select exactly one playbook with this precedence:

1. **Release** — land human-accepted verified pull requests or ordered increments. Publish, deploy, tag, distribute, or promote an artifact only when the user explicitly scopes that separate release action.
2. **Orchestration** — coordinate implementation of multiple independently reviewable goals, tickets, worktrees, workers, or stacked pull requests.
3. **Review** — evaluate existing code or a comparison and return findings without changing it.
4. **Investigation** — explain a module, research a versioned fact, audit a repository, diagnose a symptom, or recommend an option without applying it.
5. **Migration** — move data, schemas, dependencies, APIs, platforms, or ownership between versions or representations.
6. **Bug fix** — correct behavior that is wrong, failing, flaky, slow, or unsafe.
7. **Refactor** — improve structure while preserving observable behavior.
8. **Feature** — add or intentionally change product behavior in a new or existing application.

Resolve overlap by the requested result:

- “Why does this fail?” is investigation; “fix this failure” is bug fix.
- “Review this migration” is review; “perform this migration” is migration.
- “Refactor while fixing the crash” is bug fix unless the user separates the goals.
- “Ship these approved PRs” is release even when they form an ordered stack.
- A feature remains feature when its approved implementation has several dependent steps. Use orchestration only when the outcome is coordinating independent goals.
- Tests, documentation, configuration, and performance work follow the outcome they support.

When two outcomes or side effects remain plausible, name the candidates and ask one question whose answer selects between them. Hold the route and all mutation until the answer arrives.

**Complete when:** explicit request evidence supports one outcome, or one bounded clarification is pending.

## 3. Announce and load one playbook

Report:

```text
Selected playbook: <name> — <read-only|mutating>
Evidence: <request language that selected it>
Mode: <durable|plain-skills, with relevant unavailable capability>
```

Then read exactly one playbook:

| Playbook                                    | Side-effect class | Read when                                                                     |
| ------------------------------------------- | ----------------- | ----------------------------------------------------------------------------- |
| [Feature](playbooks/feature.md)             | Mutating          | Add or intentionally change behavior in a new or existing application.        |
| [Bug fix](playbooks/bug-fix.md)             | Mutating          | Correct observed defective behavior.                                          |
| [Refactor](playbooks/refactor.md)           | Mutating          | Change structure while preserving behavior.                                   |
| [Migration](playbooks/migration.md)         | Mutating          | Move a versioned dependency, data shape, API, platform, or owner.             |
| [Investigation](playbooks/investigation.md) | Read-only         | Produce bounded evidence, explanation, diagnosis, or recommendation.          |
| [Review](playbooks/review.md)               | Read-only         | Produce findings on existing code or a comparison.                            |
| [Release](playbooks/release.md)             | Mutating          | Land accepted verified PRs, or perform an explicitly scoped artifact release. |
| [Orchestration](playbooks/orchestration.md) | Mutating          | Coordinate implementation of multiple independent goals.                      |

**Complete when:** one route, its evidence, its mode, and its side-effect class are visible.

## 4. Shared mutating-work contract

Every mutating playbook uses this contract. Playbooks add outcome-specific packets and proof; they do not redefine this gate.

### Phase A — Obtain or validate approval

If the request has no approved revision, or changes behavior, goals, task scope, pull-request grouping, dependencies, or design:

1. Preserve application code, tests, configuration, dependencies, Git state, issues, pull requests, releases, and external systems unchanged.
2. Require the installed user-invoked `spec` skill. Present `/spec <request>` with the playbook's preparation packet and stop this invocation.
3. Let `spec` own Requirements, Technical Design, Plan, review gates, and the canonical `spec.md`, `plan.md`, and `approval.md`.

If the request supplies an existing approved revision:

1. Recompute the SHA-256 hashes of `spec.md` and `plan.md` and match them to `approval.md`.
2. Require explicit approval of Requirements, Technical Design, and Plan, no unresolved blocker, and a task that covers the requested action and pull-request grouping.
3. Treat any mismatch or scope departure as a return-to-planning gate. Preserve current work and describe the exact departure.

Repeating an approved task's existing implementation, verification, acceptance, or merge step does not require a new product plan. A changed goal, behavior, design, dependency, or grouping does.

**Complete when:** a current hash-matched approved task authorizes the exact next action, or `/spec` owns a bounded handoff and this invocation has stopped before mutation.

### Phase B — Execute approved increments

For each approved task or pull-request group:

1. Name the implementation owner, available host capability, approved paths and goal, expected base, required evidence, and operator permission for the immediate side effects.
2. Execute only that approved increment. Preserve unrelated user work and the approved grouping. Stop on any departure before making it.
3. Record the resulting operation identity. For code increments, include the commit, pull-request identity, actual head and base SHAs, checks run, and expected evidence IDs. For an approved non-PR external action, record its reconciled receipt and applicable evidence without inventing a commit or PR.

Durable mode may use only capabilities that are actually reachable. Plain-skills mode may perform explicitly authorized work manually in the current host, but must describe it as non-durable and cannot promise automatic scheduling or crash recovery. Git, pull-request, or external-system actions require their actual available owner and explicit operator permission.

**Complete when:** every executed increment has its approved goal, owner, applicable PR identity and exact head/base or external-action receipt, and implementation evidence recorded, while blocked increments retain their last valid state.

### Phase C — Verify the exact revision independently

A fresh verifier, not the implementer, checks the approved requirement and design slice, repository rules, required checks, production risks, and real behavior where applicable. Its verdict must bind the exact PR identity, head SHA, base SHA, and expected evidence IDs. CI alone and implementer self-report are insufficient.

A changed head, changed base, changed lower stack layer, missing surface, or unavailable independent verifier yields `stale` or `blocked`, never a passing claim. Re-run verification only after the exact revision is available.

**Complete when:** each increment has one current independent verdict for its exact head/base and evidence set, or a precise verification blocker.

### Phase D — Human acceptance and ordered landing

Present the current verified increments, dependency and group order, checks, evidence, and consequences. The human chooses accept, merge, reject, pause, or return to planning.

After explicit **merge permission**, select the release playbook in a later landing invocation. It may land only the named accepted PRs in dependency order. Before every merge it rechecks PR identity, expected base/head, current independent verification, required checks, and prerequisite state. It preserves unrelated work and stops on stale evidence or an unverified dependency.

Never auto-merge, enable auto-merge, force-push, silently rebase or restack, publish an artifact outside explicit scope, or infer permission from approval, verification, CI, or silence.

**Complete when:** the human decision is recorded and either the permitted PRs are reconciled as merged in order or landing stops with the exact unchanged blocker.

## 5. Read-only contract

Investigation and review may inspect only the bounded target and evidence sources. They return cited evidence, uncertainty, coverage, and limitations without changing code, tests, configuration, dependencies, Git, platform reviews, pull requests, releases, or external systems.

A request to apply a finding is a new mutating outcome. Route it through the shared contract; reuse a valid existing approval when it already covers that exact task rather than demanding duplicate planning.

**Complete when:** the requested answer or findings are delivered with evidence and no side effect, or a named unavailable observation blocks the answer.
