# Migration playbook

Move one versioned dependency, API, data shape, platform, or owner.

1. Discover the installed and target versions of each changed dependency, then load its matching installed library specialist. The specialist owns installed- and target-version library facts, compatibility semantics, breaking changes, and relevant failure modes. Use `research` to retrieve sources and conduct current external research.
2. For consequential compatibility or ownership decisions, use `architect` to compare alternatives and follow the mode's [requirements handoff](../SKILL.md#requirements-handoff) when an approved migration plan is needed.
3. Define a reversible sequence and the evidence required at each boundary.
4. Implement the smallest safe slice with the relevant domain skills. Check the target contract and rollback at each changed boundary; check the old contract while coexistence is required. For each omitted compatibility check, cite the approved retirement decision or report missing evidence.
5. Return completed steps, compatibility evidence, rollback path, and remaining migration work.
