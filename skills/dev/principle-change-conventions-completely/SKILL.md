---
name: principle-change-conventions-completely
description: >-
  Decide a local change that proposes a different naming, style, organization, or
  behavioral convention within an established category. Use when isolated adoption
  would leave competing conventions active inside the relevant boundary.
---

# Change Conventions Completely

Keep the established convention or replace it through an explicitly bounded complete migration. A locally preferable pattern is not enough reason for an isolated exception.

Consistency creates cognitive leverage: learning how one place works should help readers understand another. Differences should convey meaning rather than demand arbitrary relearning.

## Activation evidence

Apply when current-task evidence identifies an established convention, a proposed alternative, and the category and boundary governed by that convention.

Compare at the convention's level:

- **Naming, style, or organization:** establish the shared policy from guidance and representative occurrences. Fields such as `createdAt` and `updatedAt` have different meanings but can follow one timestamp-field naming policy; matching behavior is not required.
- **Behavioral contracts:** before merging contracts, compare purpose, inputs and outputs, invariants, failures, lifecycle, ordering, callers, ownership, and compatibility. Similar spelling or syntax alone does not prove equivalent responsibilities.

Keep intentional role and semantic distinctions explicit. A common naming policy does not require identical types or behavior, and identical names do not justify merging distinct read and write models.

## Decision rule

> Within a real convention category, keep the existing convention or complete an authorized bounded replacement; preserve differences that express meaning at the level being compared.

## Apply the rule

1. Name the existing and proposed conventions, their category, and the approved boundary. Justify the category by its shared policy or responsibility, not by selecting only the occurrences convenient to edit.
2. Inventory the category inside that boundary, including affected callers, tests, examples, and contracts. Include producers, consumers, and compatibility code when representations cross interfaces.
3. Choose **keep** or **migrate**. A replacement needs a reason and authority to complete the category, not just a locally nicer pattern. If completion exceeds the task, keep the established convention or return to planning; silently expanding scope or inventing a narrower category is not completion.
4. Keep execution proportionate. A simple internal convention change needs the inventory, coordinated edits, and relevant checks, not staged protocol choreography. Use `refactor` for behavior-preserving execution and `migration` for dependency, API, data-shape, platform, ownership, or compatibility transitions. Use `architect` for consequential target-contract decisions; these owners supply the detailed execution workflow.
5. Verify the inventory uses the target convention and the affected contracts remain correct. Claim completion only for the named category and boundary.

## Compatibility and completion

Complete means every occurrence governed by the category inside the claimed boundary follows the target policy, with no unexplained active legacy convention. A package-complete change is not repository-complete. Exclusions need a real policy, semantic, or ownership distinction, not an arbitrary partial inventory.

When compatibility requires temporary coexistence, identify the authoritative representation, permitted old/new producers and consumers, transition order, rollback, and evidence for final retirement. Check required old-client input and output behavior; accepting old keys alone does not preserve clients that read old keys. Hand detailed staging to the migration owner. A dual state without a bounded next transition and retirement criterion is not complete.

Generated or externally owned representations may remain different behind an approved adapter. Complete the owned policy without rewriting another owner's contract; distinguish an enduring boundary adapter from temporary compatibility code that must retire.

## Stop or return to planning

Stop before isolated adoption when the category or relevant contract is unresolved, the inventory cannot support completion, required compatibility or retirement decisions are missing, or completion needs unauthorized paths, owners, behavior, or pull-request grouping.

Use `principle-boundary-discipline` for a declared ownership conflict and `principle-stop-on-plan-drift` for departure from the approved task. Preserve the established convention while awaiting authority. A genuinely different category may use its own convention; a preference for a better pattern alone does not establish that category.

## Observable outcome

The change follows the established convention, completes the named replacement, or stops with the exact missing scope or design decision. Meaningful distinctions survive; unexplained competing conventions do not remain inside a claimed completed category.

When this principle changes the decision, report `Applied principle-change-conventions-completely: <category and boundary evidence> changed <isolated adoption> to <existing convention, complete migration, or planning stop>.`

## Evaluation cases

### Positive — naming across different meanings

**Input:** Owned internal timestamp fields use camelCase. A new field proposes `archived_at`; existing `createdAt` and `updatedAt` describe different events and have different update rules.

**Expected:** Apply the shared field-naming policy and use `archivedAt`. Different event semantics do not exempt a field from that naming category or require unifying the fields' behavior.

### Positive — small atomic style change

**Input:** An approved private module's four helper files use one filename style. A replacement style is justified and authorized for all four; the inventory shows no external consumers, generated names, or compatibility obligations.

**Expected:** Rename all four, update references, and run relevant checks through the refactor workflow. Inventory plus atomic edits and checks suffice; no dual-state protocol, rollback stages, or deprecation ceremony is needed.

### Negative — read and write roles

**Input:** A read model includes server-derived fields; a write command allows only client-authorized inputs. Both use camelCase and share some field names. A proposal would merge their types for consistency.

**Expected:** Preserve separate shapes because permissions and lifecycle differ. Their common naming policy remains valid without equivalent behavioral contracts.

### Boundary — complete category and public compatibility

**Input:** An approved API migration changes all public timestamp keys from snake_case to camelCase. Existing clients require a temporary old-key reader, while a vendor payload must permanently retain snake_case behind an adapter.

**Expected:** Inventory owned producers, consumers, tests, and examples; route staged compatibility to migration. Name authority, transition order, rollback, and evidence for retiring the old-key reader before claiming target-only completion. Retain the vendor adapter as an explicit ownership distinction, not unretired legacy policy.

### Boundary — scope is smaller than the category

**Input:** Package guidance defines one helper-file naming policy. A task authorizes editing only one of twelve helpers, where a different style looks better; no distinct role or policy separates that helper.

**Expected:** Follow the established style or return to planning for the full category. Do not rename the one file, call it a new category, or edit the eleven unauthorized files.

## Source provenance

The author's [Stanford naming notes](https://web.stanford.edu/~ouster/cgi-bin/cs190-winter18/lecture.php?topic=names) support consistent names and meaningful distinctions. Chapter 17's cognitive-leverage and convention-change ideas are supported here by secondary [HamerSoft notes](https://hamersoft.com/2022/07/25/67-review-a-philosophy-of-software-design-chapter-17/) and [TheDeployGuy summary](https://thedeployguy.com/2019-06-16-a-philosophy-of-software-design-summary-part-2-cp10-end/), not a reading of that chapter in the author's public second-edition extract. The bounded execution and authority rules are this skill's operational guidance.
