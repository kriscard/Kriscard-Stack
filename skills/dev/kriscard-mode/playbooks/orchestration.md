# Orchestration playbook

1. Identify independent outcomes, dependencies and conflicting changes.
2. Load [`kstack-orchestrator`](../../kstack-orchestrator/SKILL.md) to clarify scope and authority.
3. Check actual host capabilities. Kstack's Durable integration is removed for a rebuild; do not
   assume foreground roles, background workers or automatic worktree assignment are available.
4. Report missing capabilities rather than inventing worker commands. Obtain authority before
   changing executors or expanding the approved scope.

Keep planning and coordination in native Pi. Existing worktrees and source changes remain intact;
delegation, merges, publication and destructive cleanup require their own authority.
