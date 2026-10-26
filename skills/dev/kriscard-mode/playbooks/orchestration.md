# Orchestration playbook

Coordinate genuinely independent outcomes without inventing a software factory.

1. When unresolved goals, dependencies, conflicts, or ownership prevent a bounded task, follow the mode's [requirements handoff](../SKILL.md#requirements-handoff) before launching writers.
2. Separate outcomes by observable goal. Keep coupled work in one agent; identify read-only work, writers, real dependencies, and conflicting mutable areas.
3. Load [`kstack-orchestrator`](../../kstack-orchestrator/SKILL.md) to propose bounded fan-out, obtain approval, prepare isolated workers, invoke the Pi Durable backend from interactive Pi, and synthesize evidence. Inside the backend, its SDK `subagent` tool manages workers.
4. Give each worker one outcome and the matching playbook path in its bounded handoff. The worker selects that playbook and loads only its applicable installed skills; the parent remains in Orchestration. Do not send the parent transcript.
5. Leave integration, merge, release, destructive cleanup, and larger fan-out to explicit user approval.

Interactive Pi does not need a native `subagent` extension for this handoff. If the Pi Durable backend or a required execution capability is unavailable, report that specific blocker. Keep work in the main conversation only when the user permits that fallback.
