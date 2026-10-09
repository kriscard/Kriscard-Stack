# Orchestration playbook

Coordinate genuinely independent outcomes without inventing a software factory.

1. Use `spec` when goals, dependencies, conflicts, or ownership are not already clear.
2. Separate outcomes by observable goal. Keep coupled work in one agent; identify read-only work, writers, real dependencies, and conflicting mutable areas.
3. Load [`kstack-orchestrator`](../../kstack-orchestrator/SKILL.md) to propose bounded fan-out, obtain approval, prepare isolated workers, coordinate through the authoritative Herdr skill, and synthesize evidence.
4. Apply the feature, bug-fix, refactor, migration, investigation, or review skills needed inside each worker's outcome without copying their instructions or the parent transcript.
5. Leave integration, merge, release, destructive cleanup, and larger fan-out to explicit user approval.

If Herdr or a required live capability is unavailable, report orchestration as blocked and continue in one agent only when the user chooses that fallback.
