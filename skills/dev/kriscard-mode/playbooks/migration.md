# Migration playbook

Move one versioned dependency, API, data shape, platform, or owner.

1. Use `research` for current version-specific facts and identify the existing and target contracts.
2. Use `spec` or `architect` only when the migration contains consequential compatibility or ownership decisions.
3. Define a reversible sequence and the evidence required at each boundary.
4. Implement the smallest safe slice with the relevant domain skills and verify old and new behavior as applicable.
5. Return completed steps, compatibility evidence, rollback path, and remaining migration work.
