# Refactor playbook

Improve structure while preserving behavior.

1. State the structural problem and the behavior that must remain unchanged.
2. Use `refactor` with the matching technical skills to choose the smallest useful change. Add
   `codebase-design` when interfaces or dependency boundaries are involved, not for tiny mechanical
   edits.
3. Identify checks that exercise the behavior being preserved. Run them before changing structure; add focused executable evidence for any affected behavior they do not observe. Report a missing observation as a gap rather than assuming existing coverage is sufficient.
4. Refactor without expanding the public contract, then rerun the same evidence.
5. Return the structural improvement, preserved behavior, checks, and any follow-up deliberately left out.
