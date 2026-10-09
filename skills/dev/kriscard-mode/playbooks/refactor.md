# Refactor playbook

Improve structure while preserving behavior.

1. State the structural problem and the behavior that must remain unchanged.
2. Use `refactor` and any matching codebase-design skill to choose the smallest useful boundary.
3. Establish executable behavior evidence before changing structure when coverage is weak.
4. Refactor without expanding the public contract, then rerun the same evidence.
5. Return the structural improvement, preserved behavior, checks, and any follow-up deliberately left out.
