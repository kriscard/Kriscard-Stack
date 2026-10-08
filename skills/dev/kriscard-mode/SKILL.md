---
name: kriscard-mode
description: >-
  Route engineering work through Kriscard Stack when the user enables Kriscard mode
  or asks for its feature, bug-fix, refactor, migration, investigation, review,
  release, or multi-ticket orchestration workflow.
---

# Kriscard Mode

Select one focused playbook, state it, and keep its side-effect boundary visible.
This skill routes work; it does not replace the general-purpose Skills collection.

## 1. Check the operating mode

Determine which capabilities are actually available before promising work:

- **Durable mode:** the Kriscard Stack control plane is reachable and reports the requested capability.
- **Plain-skills mode:** this skill and the compatible `kriscard/Skills` catalog are installed, but the control plane is unavailable.

Plain-skills mode can route, investigate, review, and run the `/spec` planning lifecycle in the current host session. It cannot provide crash-safe state, durable leases, automatic ready-frontier scheduling, isolated worker launch, resumable orchestration, or independent verification. Say which unavailable capability blocks the requested next step. Ordinary chat or terminal state is not a durable substitute.

Confirm required named skills are installed before handing work to them. A missing required skill is a blocker: name it, identify the selected playbook and failed stage, preserve existing work, and give the user the install or setup action when known. Continue only after the dependency is available; never silently approximate another skill's contract.

**Complete when:** the mode is named honestly and every required dependency for the next step is available or reported as a blocker.

## 2. Classify by requested outcome

Use the user's requested outcome, not isolated nouns in issue text or repository files. Select exactly one playbook with this precedence:

1. **Orchestration** — coordinate multiple independently reviewable goals, tickets, worktrees, workers, or stacked pull requests.
2. **Release** — publish, deploy, tag, distribute, or promote an already built artifact.
3. **Review** — evaluate existing code or a diff and report findings without changing it.
4. **Investigation** — explain, research, audit, or diagnose and report evidence without applying a fix.
5. **Migration** — move data, schemas, dependencies, platforms, APIs, or ownership from one version or representation to another.
6. **Bug fix** — correct observed behavior that is wrong, failing, flaky, slow, or unsafe.
7. **Refactor** — improve code structure while preserving observable behavior.
8. **Feature** — add or intentionally change product behavior not covered above.

Intent controls overlap:

- “Why does this fail?” is an investigation; “fix this failure” is a bug fix.
- “Review this migration” is a review; “perform this migration” is a migration.
- “Refactor while fixing the crash” is a bug fix unless the user separates the goals.
- A release containing many artifacts remains a release unless the request is to coordinate independent implementation goals.
- Tests, documentation, configuration, and performance work follow the outcome they support rather than becoming extra playbooks.

If two outcomes remain plausible or the requested side effects are unclear, state the candidate playbooks and ask one question that distinguishes them. Do not select a route, inspect beyond what is needed to clarify, or mutate anything until the answer resolves the ambiguity.

**Complete when:** one outcome is supported by explicit request evidence, or one bounded clarification is pending.

## 3. Announce and load one playbook

Before proceeding, say:

```text
Selected playbook: <name> — <read-only|mutating>
Evidence: <the request language that determined the route>
Mode: <durable|plain-skills>
```

Then read exactly the selected file:

| Playbook                                    | Side-effect class | Read when                                                                      |
| ------------------------------------------- | ----------------- | ------------------------------------------------------------------------------ |
| [Feature](playbooks/feature.md)             | Mutating          | The outcome adds or intentionally changes product behavior.                    |
| [Bug fix](playbooks/bug-fix.md)             | Mutating          | The outcome corrects observed defective behavior.                              |
| [Refactor](playbooks/refactor.md)           | Mutating          | The outcome changes structure while preserving behavior.                       |
| [Migration](playbooks/migration.md)         | Mutating          | The outcome moves a versioned dependency, data shape, API, platform, or owner. |
| [Investigation](playbooks/investigation.md) | Read-only         | The outcome is evidence or explanation without a fix.                          |
| [Review](playbooks/review.md)               | Read-only         | The outcome is findings on existing code or a comparison.                      |
| [Release](playbooks/release.md)             | Mutating          | The outcome publishes, deploys, tags, distributes, or promotes an artifact.    |
| [Orchestration](playbooks/orchestration.md) | Mutating          | The outcome coordinates multiple independent goals or workers.                 |

A read-only route has no mutation grant. A mutating route has no implementation grant: it must enter the exact `/spec` lifecycle first.

**Complete when:** the route, evidence, mode, and side-effect class are visible and only one playbook is loaded.

## 4. Enforce the mutation gate

For every mutating playbook:

1. Keep application code, tests, configuration, dependencies, Git state, issues, pull requests, releases, and external systems unchanged.
2. Require the installed `spec` skill. It is user-invoked, so present the exact `/spec <request>` handoff with the relevant source context and stop; do not claim to invoke it on the user's behalf.
3. Let `spec` own discovery, Requirements, Technical Design, Plan, review gates, `spec.md`, `plan.md`, and `approval.md`.
4. When a later invocation receives the completed artifacts, recompute the SHA-256 hashes of `spec.md` and `plan.md`; require them to match `approval.md`, require all three stage approvals, and require no unresolved blocker.
5. Report the approved artifact paths and stop. A separate approved implementation workflow may consume them; Kriscard Mode does not continue into mutation in this invocation.

An absent approval, changed artifact, hash mismatch, or unresolved blocker ends the run at the planning stage. Existing user work remains untouched.

For read-only playbooks, remain inside the selected file's read boundary. If the user asks to apply a finding, treat that as a new mutating request and route it through `/spec` rather than continuing under the read-only route.

**Complete when:** read-only work returns evidence without side effects, or mutating work stops with a current approved artifact set and no user-work mutation.
