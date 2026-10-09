---
name: principle-minimize-context
description: >-
  Build bounded worker or verifier context when available source material contains
  broad history, unrelated files, or large command output. Use to retain the facts
  needed for one assigned decision while excluding noise and linking full receipts.
---

# Minimize Context

Give an agent the smallest packet that is sufficient to make its assigned decision correctly and safely.

## Activation evidence

Apply this principle when constructing or refreshing model-facing context and the candidate material contains more than the assigned decision needs, such as:

- requirements, design sections, tasks, paths, or principles for other work;
- complete conversation history when current approved artifacts are authoritative;
- broad repository listings or files unrelated to the assigned change;
- large logs, test output, generated content, or repeated diagnostics that can be filtered mechanically.

Do not activate merely because a directly relevant artifact has several lines. First identify what the assigned decision requires. Repository instructions, user constraints, conflicting facts, safety conditions, and evidence provenance remain relevant even when they consume context.

## Decision rule

> Send only the assigned requirements, design decisions, task, governing instructions, relevant paths and interfaces, applicable principles, known blockers, and required evidence; mechanically filter large output and retain a durable pointer to the full receipt.

## Apply the rule

1. State the single decision or task the packet must support.
2. Select the governing repository instructions and only the approved requirement, design, task, path, interface, principle, blocker, and evidence slices needed for that decision.
3. Preserve exact text when wording, hashes, identifiers, commands, or constraints are material. Do not replace a necessary primary source with an unsupported summary.
4. For large mechanical output, include the command, exit status, relevant error or result lines with bounded surrounding context, and a pointer to the full receipt. Filter deterministically before model consumption rather than asking the model to read everything.
5. Exclude unrelated history, duplicated excerpts, other workers' task packets, unused principles, and raw output already represented by the bounded evidence.
6. Record what was included, what class of material was excluded, and where any full receipt can be inspected. Never put a secret into the packet or its pointer metadata.

When this principle materially removes or filters candidate context, name `principle-minimize-context` in the packet manifest.

## Limits and counterexamples

- Keep a small, directly relevant artifact intact when splitting it would obscure meaning or save no useful context.
- Do not omit adverse evidence, repository rules, user constraints, security requirements, or a contradiction because they make the packet less convenient.
- Relevant surrounding code and interface contracts are not noise. Include enough to reason about callers, effects, and safe validation.
- A summary is not a receipt. Keep the stable pointer and provenance needed to inspect the source.
- A pointer alone is insufficient when the worker needs the actual bounded fact to decide or act.
- Context minimization narrows what an agent consumes; it does not delete source artifacts, logs, or durable evidence.
- Load only principles supported by current task evidence. Do not attach the whole principle collection for convenience.

## Observable decision

Without this principle, a worker may receive an entire plan, transcript, catalog, or raw log. With it, the packet contains only the assigned slices and bounded output, while durable pointers preserve inspectability and required safety context remains visible.

## Evaluation cases

### Positive — mixed program history

**Input:** A worker assigned one requirement and two paths is about to receive the whole specification, every task packet, prior chat history, and a full successful build log.

**Expected:** Activate the principle. Send the assigned requirement, relevant design and task slices, governing instructions, the two paths and interfaces, required evidence, and a compact build result; exclude unrelated history and tasks while retaining the build receipt pointer.

### Negative — small relevant artifact

**Input:** A short interface definition is directly required to understand the assigned caller change, and every line affects the decision.

**Expected:** Do not activate the principle merely to shorten it. Include the interface intact.

### Boundary — large relevant failure log

**Input:** A required test emits a very large failure log. The command, exit status, first causal error, and nearby stack frames are necessary; repeated frames and unrelated passing output are not.

**Expected:** Activate the principle without hiding the failure. Include the command, failed status, causal excerpt, bounded frames, and durable full-log pointer; exclude repeated and unrelated output.
