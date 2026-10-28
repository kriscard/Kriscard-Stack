# Review playbook

Review one bounded artifact or change. For code, challenge the implementation, not just the absence
of obvious bugs. For instructions or prose, check executable routing, ownership, and the reader's job
rather than forcing code-only criteria.

1. **Agree the mode.** Default to a read-only review. A full review → fix → verify loop requires
   explicit authorization for the writer's scope, reviewer topology, executor, checks, and budget.
   Read [Review execution](../references/review-execution.md) before delegated review or a full loop.
   Remain in this playbook as coordinator; a writer selects the appropriate implementation playbook.
2. **Pin the packet.** For code, load the installed `code-review` skill and select its matching
   PR/branch, working-tree/selected-code, or authorized full-loop playbook. It owns comparison
   acquisition, originating requirements, technical review, and the portable review workflow.
   Apply `writing-for-agents` (including its skill mechanics for skills) to agent instructions and
   `writing-guidelines` to prose style, including when those artifacts are delivered in a PR.
   Load matching UI or technical specialists only for the artifact's actual surface. Mixed changes
   need each applicable lens, not every available skill. Capture intent, base/head or an immutable
   local snapshot, instructions, requirements, accepted patterns and relevant callers or linked
   documents. Keep personal taste, project rules, and reviewer heuristics distinguishable; surface
   conflicts.
3. **Challenge the implementation.** With authorization and capability, use two independent read-only
   reviewers, each receiving the same packet and every applicable review axis. Ask for concrete
   simpler alternatives: which branches, layers, helpers, state, or caller responsibilities could
   disappear? Inspect boundaries, composition, types, policy ownership, and conventions—not a generic
   risk checklist alone. For instructions, trace invocation, branch triggers, completion conditions,
   and authority boundaries; for prose, check the stated reader job and factual claims. Report
   concrete reachable failures or structural costs, not preferences. Follow each selected skill's
   applicable evidence gates and source references.
4. **Adjudicate.** Check candidates against real callers, constraints, and alternatives. Record
   `Act on`, `Consider`, `Noted`, or `Dismissed` with evidence and rationale. Agreement is a signal,
   not proof. A structural quality issue can warrant correction without a production incident.
   Return the findings here for a review-only request; do not claim independent verification.
5. **Repair only when authorized.** Give one writer the accepted findings, preserved behavior,
   allowed paths, and observable quality improvements. Meaningful simplification is welcome inside
   scope. A contract change, broader migration, or disputed design returns to the user. Re-pin the
   new revision and re-review affected code; never reuse a stale verdict.
6. **Verify independently.** A fresh verifier, distinct from the author and fix-proposing reviewers,
   checks the final revision against requirements, accepted quality improvements, repository checks,
   and applicable real behavior. It receives bounded evidence, not implementation conversations.
7. **Audit the verifier.** The lead reads the actual commands, results, tests, relevant code, and
   observation artifacts. Challenge self-derived expectations, mocks bypassing the claimed boundary,
   stale revisions, omitted failure paths, and unsupported passes. Resolve gaps with evidence within
   the agreed budget; otherwise report the missing observation or decision. Do not start an endless
   chain of verifier agents.
8. **Report the outcome.** Include the revision, quality conclusion, prioritized findings and
   decisions, reviewer identities, verifier result, evidence-audit result, and remaining uncertainty.
   Distinguish `review complete — not independently verified`, `full loop ready`, and `blocked`.
   A full-loop readiness claim requires all agreed stages and no unresolved blockers. Stop at the
   agreed round/budget limit, not when a model emits a reassuring phrase.

Reviewers remain read-only. A full loop authorizes only the agreed repairs and checks, not platform
comments, publishing, merging, runtime changes, global installation, or destructive cleanup.
