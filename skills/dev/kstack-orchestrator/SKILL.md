---
name: kstack-orchestrator
description: Clarify independent outcomes and their ownership from native Pi when orchestration is requested. Core role tools do not supply background or parallel workers.
---

# Kstack Orchestrator

Keep coordination in native Pi. Clarify the requested outcomes, dependencies, approval gates and
which changes could conflict. Preserve existing work and obtain authority before delegating.

Check the tools supplied by the current host. Kstack's core `durable_plan`, `durable_implement` and
`durable_review` tools serve bounded role calls in native Pi, not a background worker fleet. Follow
[Kriscard Mode's role boundaries](../kriscard-mode/SKILL.md#execution) for those calls.

Background/parallel execution remains deferred. Report that limitation; obtain authority before
using another available executor. The removed worker commands and receipt protocol stay removed.

SSH, Mosh and terminal-session management belong to the user's environment, not this skill.
