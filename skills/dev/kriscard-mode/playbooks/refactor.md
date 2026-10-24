# Refactor playbook

Improve structure while preserving behavior.

1. State the structural problem and the behavior that must remain unchanged.
2. Use `refactor` with the matching technical skills to choose the smallest useful change. Add
   `codebase-design` when interfaces or dependency boundaries are involved, not for tiny mechanical
   edits.
3. Establish executable behavior evidence before changing structure when coverage is weak.
4. Refactor without expanding the public contract, then rerun the same evidence.
5. Return the structural improvement, preserved behavior, checks, and any follow-up deliberately left out.
