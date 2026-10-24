# Artifact quality benchmark

Use this reference before admitting a principle, playbook, or generic skill to the shortlist and again when proposing or writing it.

The principle and playbook standards were derived from all 24 `principle-*` skills and all 23 Poteto mode playbooks in Cursor's Pstack repository: <https://github.com/cursor/plugins/tree/main/pstack/skills>. The generic skill standard follows `writing-for-agents`. These are quality benchmarks, not material to copy. Keep Pstack-specific tools, models, delegation rules, and repository conventions out of Kriscard Stack unless this repository independently needs them.

## Choose the right artifact

Choose a **principle** for one reusable decision rule that applies inside more than one workflow. It changes what the agent decides when a recognizable situation occurs. It is not merely advice and is not an end-to-end procedure.

Choose a **playbook** for one complete kind of work with an owner, ordered phases, gates, evidence, and a defined handoff or final reply. It coordinates principles and skills rather than restating them.

Choose a **generic skill** for one recurring user job useful beyond a single Kstack workflow. It needs its own trigger, bounded process, output, and completion criteria. General-purpose skills belong to `kriscard/Skills`.

If an idea does not meet one definition, do not force it into an artifact.

## Principle benchmark

A principle may be supported by any of these evidence paths:

- a substantive, durable engineering belief stated by the user;
- repeated Kstack failures, near misses, or corrections; or
- several notes or sources teaching the same lesson.

Combined evidence strengthens the candidate, but no evidence path excuses a vague rule.

A strong principle:

- uses a plain action name rather than a slogan;
- identifies the bad default or tempting choice it replaces;
- has a frontmatter description that starts with the concrete situation in which to apply it;
- states the changed decision immediately;
- gives a test, contrast, sequence, or example that makes the rule usable;
- names the important exception or stop condition;
- changes an observable decision or action;
- stays narrow enough to remember and reuse across workflows; and
- links to complementary principles without repeating their content.

A proposed principle passes only when a reviewer can answer:

1. Which evidence path supports it?
2. What exact situation activates it?
3. What bad default does it replace?
4. What decision changes, and what should the agent do instead?
5. What case is outside the rule or stops it?
6. How could an evaluation distinguish compliance from non-compliance?

Keep only prose that changes a decision. Explain why when the rule would otherwise be confusing, but do not turn the principle into an essay, topic summary, or source review.

## Playbook benchmark

Prefer a real recurring workflow the user already performs. Several related notes may also justify an inferred workflow when the job is coherent. Label inferred playbooks explicitly, give them lower confidence than observed workflows, and never present an inference as established practice.

A strong playbook:

- names one recognizable job;
- opens with a short ownership statement;
- identifies what triggers the job and why current routing is insufficient;
- distinguishes itself from adjacent playbooks;
- orders the work as executable phases rather than a collection of tips;
- names the gates that must pass before the next phase;
- routes specialized work to its owning skill or principle instead of restating it;
- requires evidence from the surface that matters, not a convenient proxy;
- defines where the workflow stops and what happens next; and
- ends with a concrete reply contract listing what the user receives.

A proposed playbook passes only when a reviewer can answer:

1. Is this an observed workflow or an inferred one?
2. What job routes here instead of to a neighboring playbook?
3. Why are the current playbooks not enough?
4. What does the agent own?
5. What are the ordered phases and gates?
6. Which existing skills or principles own specialized decisions?
7. What real evidence proves completion?
8. Where does the playbook stop?
9. What exact result is reported to the user?

Commands, artifact paths, checklists, and templates belong in the playbook only when they make completion auditable and are stable for this repository. Avoid importing Pstack's orchestration machinery merely to imitate its level of detail.

## Generic skill benchmark

Before proposing a generic skill, inspect the full contents of every plausible installed skill that might own the job. Compare their triggers, responsibilities, process, boundaries, outputs, and completion criteria rather than their titles alone.

A strong generic skill:

- serves one exact recurring user job;
- has a trigger distinct enough for the model or user to invoke reliably;
- owns a bounded process rather than a collection of useful facts;
- names its boundaries and neighboring owners;
- produces a concrete output; and
- has checkable completion criteria.

A proposed generic skill passes only when a reviewer can answer:

1. What exact user job triggers it?
2. Which existing skills were inspected?
3. What contract is missing from those skills?
4. Why is this an update rather than a new skill, or a new skill rather than an update?
5. What process, output, boundary, and completion criterion will the skill own?

A small decision rule belongs in a principle. Coordination specific to one Kstack workflow belongs in a playbook. A useful body of knowledge without a distinct user job is not enough for a skill.

## Compare before shortlisting

Read every plausible existing artifact before admitting a candidate. “Plausible” means it handles the same trigger, decision, user job, responsibility, process, or output even when its name differs.

Remove an idea when an existing artifact already handles it well. Otherwise, every candidate must name:

- every plausible existing artifact inspected;
- the closest existing owner; and
- the exact missing behavior that justifies an update or new artifact.

A weak fit, an unproven gap, or an already-covered idea does not enter the shortlist.
