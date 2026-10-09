# Review playbook

Review one bounded target without modifying it.

1. Select `pr-review` for a pull request or branch comparison; otherwise use `review` for selected or local code.
2. Read the target, repository rules, and originating specification when one exists.
3. Report only evidence-backed defects that materially affect correctness, security, performance, or maintainability.
4. Return findings in severity order with exact locations, followed by coverage and remaining uncertainty.

Remain read-only. Fixing a finding is a new bug-fix, refactor, or feature request.
