# Orchestration playbook

1. Identify independent outcomes, dependencies and conflicting changes.
2. Load [`kstack-orchestrator`](../../kstack-orchestrator/SKILL.md) to clarify scope and authority.
3. Check actual host capabilities. Kstack's three core role tools serve bounded calls in native Pi;
   they do not supply background/parallel orchestration or automatic worktree assignment.
4. Report deferred capabilities rather than inventing worker commands. Obtain authority before
   changing executors or expanding the approved scope.

Keep planning and coordination in native Pi. Existing worktrees and source changes remain intact;
delegation, merges, publication and destructive cleanup require their own authority.
