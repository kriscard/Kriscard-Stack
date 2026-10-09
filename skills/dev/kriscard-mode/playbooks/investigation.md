# Investigation playbook

> **Read this when:** the outcome is evidence, explanation, diagnosis, or a recommendation without applying a change.
>
> **Side-effect class:** Read-only.

## Lead responsibility

Own the bounded question, evidence trail, and uncertainty. Choose one branch by the observation needed:

- **Symptom diagnosis:** use general `debug` for broken, flaky, slow, or unexplained behavior and stop before its fix phase.
- **Version research:** use general `research` for a version-sensitive library, framework, SDK, provider, or API fact.
- **Repository audit:** use general `analyze-repo` only for an explicitly requested whole-repository architecture or technical-debt audit.
- **Scoped explanation:** directly inspect the named module or subsystem, its immediate callers and callees, nearby tests, configuration, and documentation. No separate “how” skill is assumed.
- **Recommendation:** compare bounded options from cited repository facts; consult `architect` only for a consequential boundary decision.

A missing named skill blocks only its matching branch. When the question and scope are already concrete, proceed rather than asking the user to restate them.

## Procedure

1. State the exact question, bounded target, and observation that would answer it.
2. Follow the selected branch and keep all tools read-only with respect to source, Git, platform state, and external systems.
3. Distinguish observed facts, supported inference, and unknowns.
4. Return the branch-specific result:
   - diagnosis: symptom, causal evidence or ranked unresolved hypotheses, and reproduction;
   - research: version boundary, answer, and primary sources;
   - audit: evidence ledger and bounded findings from `analyze-repo`;
   - explanation: control/data flow with cited paths and symbols, immediate callers/callees, and relevant tests;
   - recommendation: options, trade-offs, evidence, and the decision still owned by the user.

**Complete when:** every material claim cites a file, symbol, command result, or primary source; the requested scope is answered; and unobserved behavior is labeled rather than guessed.

## Boundary and output

Do not edit files, install dependencies, change Git, post reviews, create or modify PRs, publish, deploy, release, or alter external systems. If the user asks to apply the result, route that new outcome through the shared mutating-work contract.

**Output:** a bounded factual explanation, diagnosis, research answer, audit, or recommendation with citations, coverage, uncertainty, and no side effects.
