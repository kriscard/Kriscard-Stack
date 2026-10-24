---
name: kstack-generate-principles
description: >-
  Generate evidence-backed improvement candidates from configured Obsidian
  knowledge, then deepen only the user's selections into proposals for new or
  updated principles, Kriscard mode playbooks, or generic skills. Use when vault
  knowledge should improve how Kstack works. Do not use for ordinary vault recall
  or modify any repository without explicit approval.
---

# Generate Kstack Improvements

Turn durable vault knowledge into selective improvements to how Kriscard Stack and its generic skills make decisions and perform engineering work. The goal is not to turn every useful note into an artifact. Admit only candidates that express a strong artifact shape and fill a proven gap.

## Plain-language output

“Stop using jargon when not necessary and speak coherently. State it more simply and concisely, like one human talking or writing to another.”

Apply this to every user-facing part of the workflow. Candidate names must state the action clearly. Avoid abstract noun stacks, compressed slogans, and metaphors.

Completion: candidate names, explanations, proposals, and approval questions are understandable without translation.

## 1. Build the configured evidence set

Load the installed `vault` and `memory-recall` skills. Follow the live vault schema, including its required personal-context reads and ownership rules.

Read `index.md` in full. Resolve and read these configured knowledge views and their Base definitions:

- Career MOC;
- Dotfiles MOC;
- Productivity MOC;
- Software Development MOC;
- Work MOC; and
- Weekly Learnings Base.

Materialize each Base with Obsidian when available; otherwise apply its folder and tag filters to filesystem metadata. The user's folder and tag maintenance defines this scope. Do not compensate for missing metadata by scanning the rest of the vault.

Union and deduplicate every surfaced note. Inspect every note's title, aliases, tags, links, catalog summary, and searchable body text. Search across the artifact types and every technical lens defined in step 3. Use QMD and filesystem search across the complete surfaced set; a small top-N result cannot define the candidate pool.

Classify every surfaced note as relevant, uncertain, or excluded with a reason. Fully read every relevant or uncertain note. Follow material links, backlinks, and raw sources that support or contradict a possible improvement. Treat raw sources as evidence and agent-written synthesis as interpretation. Treat substantive user-authored prose as the user's stated understanding. An empty, templated, or link-only scaffold is not evidence.

Create a temporary coverage receipt outside the vault and repositories. Record:

- configured views, Base filters, and result counts;
- every surfaced note and its classification;
- every fully read note;
- query families, technical lenses, and commands;
- the result of every artifact-type and technical-lens pass;
- followed evidence sources; and
- unavailable or failed search surfaces.

In the user-facing response, report only the counts, filters, failures, and receipt path. If a configured view cannot be materialized, any surfaced note is unclassified, or any relevant or uncertain note was not read fully, stop and report the coverage gap.

Completion: the complete configured set was classified, every relevant or uncertain note was read fully, and the temporary receipt makes coverage auditable without burying the shortlist.

## 2. Inspect current owners before generating candidates

Locate the Kriscard Stack checkout by verifying that its root contains `AGENTS.md`, `skills/README.md`, and `skills/dev/kriscard-mode/SKILL.md`. The active working directory is only a candidate location. If the checkout is ambiguous, ask for its path and stop.

Read `skills/README.md`, every Kstack-owned `SKILL.md` under `skills/dev/`, and every `skills/dev/kriscard-mode/playbooks/*.md`. Inventory all installed skill descriptions.

Read [`references/quality-benchmark.md`](references/quality-benchmark.md). For each emerging idea, identify every existing artifact that handles the same trigger, decision, user job, responsibility, process, boundary, output, or completion criterion. Read every plausible match in full before admitting the idea to the shortlist. Similar names are neither required nor sufficient.

Remove ideas already handled well. A surviving candidate must name every plausible match inspected, the closest existing owner, and the exact missing behavior.

Completion: no candidate reaches discovery without a full comparison against its plausible current owners.

## 3. Run artifact and technical discovery passes

Run independent artifact passes for principles, playbooks, and generic skills. Within every artifact pass, search each technical lens separately:

- component composition, component APIs, and reusable patterns;
- software architecture, domain modeling, boundaries, and data flow;
- React, Next.js, React Server Components, and other framework-specific behavior;
- design engineering, interaction design, accessibility, animation, and visual quality;
- reverse engineering, runtime and trace forensics, and code comprehension;
- testing, performance, reliability, security, and developer tooling; and
- AI-assisted engineering, review, workflow, and engineering productivity.

A note can support candidates in several lenses. The lenses are search obligations, not output categories. Do not find broad ideas first and leave either artifact classification or technical coverage until later.

### Principles

A principle may come from:

- a durable engineering belief stated by the user;
- repeated Kstack failures, near misses, or corrections; or
- several notes or sources teaching the same lesson.

Combined evidence makes a candidate stronger. Apply the principle benchmark before admission. Reject advice that cannot name the bad default, trigger, changed decision, important exception, and observable evaluation.

### Playbooks

Search for recurring jobs that current Kriscard mode routing does not handle well. Prefer observed workflows. Allow a coherent workflow inferred from several notes, but label it **Inferred** and rank it below a comparable observed workflow.

Apply the playbook benchmark before admission. Reject a workflow that cannot name its trigger, current routing gap, owner, ordered phases, gates, real evidence, stopping point, and reply contract.

### Generic skills

Search for recurring user jobs useful beyond one Kstack workflow. Load `writing-for-agents`. Before admission, read every plausible installed skill in full and decide whether the job belongs in an existing skill or needs a new owner in `kriscard/Skills`.

Apply the generic skill benchmark before admission. Reject a candidate that cannot name the exact user job, installed skills checked, missing contract, process, output, boundary, and completion criterion.

For an empty artifact or technical-lens pass, record which artifacts and evidence were checked and why nothing passed. Do not invent a weak candidate to fill a section.

Completion: every artifact type was crossed with every technical lens, producing only benchmark-passing, gap-proven candidates or an auditable reason that none survived.

## 4. Rank and offer candidates

Rank candidates primarily by:

1. how strongly they reflect the user's engineering beliefs;
2. how often they would improve real work;
3. how clearly they fill a current gap; and
4. the strength of their evidence.

The number of notes mentioning an idea is supporting evidence, not the ranking rule.

Require no minimum. Present at most ten candidates total. If multiple sections have passing candidates, include the strongest candidate from each represented section before filling the remaining slots by overall rank. If any technical lens has a passing domain-specific candidate, include the strongest such candidate before filling the remaining slots with broader workflow candidates.

Always organize the shortlist under these headings, in this order:

1. **Principles**;
2. **Playbooks**; and
3. **Generic skills**.

Within each section, use **New** and **Updates** subheadings.

For every candidate include:

- New or Update;
- a plain-language action name;
- technical lens;
- evidence path and supporting `[[wikilinks]]` or paths;
- plausible existing artifacts inspected;
- closest existing owner;
- exact missing behavior; and
- why the change would improve the user's engineering work.

Also include the artifact-specific proof:

- **Principle:** bad default, trigger, changed decision, and exception.
- **Playbook:** Observed or Inferred, job, current routing gap, main phases, and gates.
- **Generic skill:** exact user job, installed skills checked, and missing contract.

For an empty subsection, write “No candidates” and briefly state what was checked and why nothing passed. Keep this pass to candidate proof, not full artifact drafts or evaluation cases.

Stop after the shortlist. Ask the user to select candidates, request another search direction, or finish. Only selected candidates proceed.

Completion: the user has no more than ten gap-proven candidates, with strong categories represented and empty categories explained.

## 5. Deepen the selections

For selected candidates only, resolve the exact owning repository and path. Principles and Kriscard mode playbooks belong to Kriscard Stack. Generic skills belong to `kriscard/Skills`.

Recheck every selected candidate against current artifacts and the quality benchmark. Classify it as:

- **Add:** no current artifact owns the required behavior;
- **Update:** a current artifact owns the behavior but has a proven contract gap; or
- **No change:** deeper inspection shows the behavior is already covered, lacks evidence, or is project-specific.

Apply `principle-boundary-discipline` before recommending a location. Do not copy a generic skill into Kriscard Stack.

Completion: every selected candidate has one outcome, one owner, one artifact type, and an explicit overlap rationale.

## 6. Present selected proposals

Present proposals under **Principles**, **Playbooks**, and **Generic skills**. For each selected candidate include:

- outcome and artifact type;
- proposed name and exact path;
- recurring job or decision changed;
- trigger, rule or process, limits, output, and observable change;
- vault evidence;
- existing artifacts compared and the proven gap;
- contradictions, confidence, and missing evidence;
- benchmark result and failed questions, if any;
- exact files in the owning repository that would change; and
- positive, negative, and boundary evaluation cases.

Separate what the vault states from the recommendation. Ask for explicit approval of the exact add or update set.

Completion: the user can approve, reject, or revise every proposal independently.

## 7. Apply an approved proposal

After approval, load `writing-for-agents`. Edit only approved principles and playbooks owned by Kriscard Stack. A generic skill proposal stops at an approved handoff to `kriscard/Skills`; do not edit or copy that owner's files from this workflow.

Match the existing artifact shape and applicable benchmark. Keep vault citations in the proposal rather than making runtime artifacts depend on vault access.

Add or update executable repository tests when they protect discoverability or a required contract. Follow repository formatting, linting, and verification instructions. If repository evidence conflicts with the approved proposal, apply `principle-stop-on-plan-drift` and return to the user before changing the design.

Completion: only approved files changed, checks passed or have exact reported blockers, and the final report maps every change to the approved proposal.
