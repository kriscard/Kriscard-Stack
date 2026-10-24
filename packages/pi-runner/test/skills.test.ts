import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const skillsRoot = resolve(root, "skills");

const orchestratorRoot = resolve(skillsRoot, "dev/kstack-orchestrator");

const generatedPrinciplesRoot = resolve(skillsRoot, "dev/kstack-generate-principles");

const qualityBenchmark = resolve(generatedPrinciplesRoot, "references/quality-benchmark.md");

async function skillFiles(directory: string): Promise<string[]> {
  const files: string[] = [];

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);

    if (entry.isDirectory()) files.push(...(await skillFiles(path)));

    if (entry.isFile() && entry.name === "SKILL.md") files.push(path);
  }

  return files;
}

function frontmatter(contents: string): Map<string, string> {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(contents);

  if (!match) throw new Error("Missing frontmatter");

  return new Map(
    match[1].split("\n").flatMap((line) => {
      const separator = line.indexOf(":");

      if (separator === -1) return [];

      return [[line.slice(0, separator), line.slice(separator + 1).trim()]];
    }),
  );
}

test("keeps every installed skill discoverable with one owner name", async () => {
  const files = await skillFiles(skillsRoot);
  const names = new Set<string>();

  for (const file of files) {
    const metadata = frontmatter(await readFile(file, "utf8"));
    const name = metadata.get("name");
    expect(name, file).toBe(dirname(file).split("/").at(-1));
    expect(metadata.get("description"), file).toBeTruthy();
    expect(names.has(name ?? ""), `Duplicate skill name: ${name}`).toBe(false);
    names.add(name ?? "");
  }

  expect(names).toContain("kriscard-mode");
  expect(names).toContain("kstack-orchestrator");
  expect(names).toContain("kstack-generate-principles");
});

test("turns vault evidence into user-selected Kstack improvements", async () => {
  const skill = await readFile(resolve(generatedPrinciplesRoot, "SKILL.md"), "utf8");

  expect(skill).toContain("Read `index.md` in full");
  expect(skill).toContain("Career MOC");
  expect(skill).toContain("Dotfiles MOC");
  expect(skill).toContain("Productivity MOC");
  expect(skill).toContain("Software Development MOC");
  expect(skill).toContain("Work MOC");
  expect(skill).toContain("Weekly Learnings Base");
  expect(skill).toContain("user's folder and tag maintenance defines this scope");
  expect(skill).toContain("Classify every surfaced note as relevant, uncertain, or excluded");
  expect(skill).toContain("Fully read every relevant or uncertain note");
  expect(skill).toContain("a small top-N result cannot define the candidate pool");
  expect(skill).toContain("Create a temporary coverage receipt outside the vault and repositories");
  expect(skill).toContain("report only the counts, filters, failures, and receipt path");
  expect(skill).toContain("Inspect current owners before generating candidates");
  expect(skill).toContain("every plausible match in full before admitting the idea");
  expect(skill).toContain("Similar names are neither required nor sufficient");
  expect(skill).toContain("Run artifact and technical discovery passes");
  expect(skill).toContain("component composition, component APIs, and reusable patterns");
  expect(skill).toContain("React, Next.js, React Server Components");
  expect(skill).toContain("design engineering, interaction design, accessibility");
  expect(skill).toContain("reverse engineering, runtime and trace forensics");
  expect(skill).toContain("testing, performance, reliability, security, and developer tooling");
  expect(skill).toContain("Do not find broad ideas first");
  expect(skill).toContain("a durable engineering belief stated by the user");
  expect(skill).toContain("repeated Kstack failures, near misses, or corrections");
  expect(skill).toContain("label it **Inferred**");
  expect(skill).toContain("For an empty artifact or technical-lens pass");
  expect(skill).toContain("every artifact type was crossed with every technical lens");
  expect(skill).toContain("how strongly they reflect the user's engineering beliefs");
  expect(skill).toContain("The number of notes mentioning an idea is supporting evidence");
  expect(skill).toContain("Require no minimum");
  expect(skill).toContain("at most ten candidates total");
  expect(skill).toContain("include the strongest candidate from each represented section");
  expect(skill).toContain("include the strongest such candidate");
  expect(skill).toContain("technical lens;");
  expect(skill).toContain("1. **Principles**;");
  expect(skill).toContain("2. **Playbooks**;");
  expect(skill).toContain("3. **Generic skills**.");
  expect(skill).toContain("plausible existing artifacts inspected");
  expect(skill).toContain("closest existing owner");
  expect(skill).toContain("exact missing behavior");
  expect(skill).toContain("bad default, trigger, changed decision, and exception");
  expect(skill).toContain("Observed or Inferred");
  expect(skill).toContain("installed skills checked, and missing contract");
  expect(skill).toContain("Stop after the shortlist");
  expect(skill).toContain("Only selected candidates proceed");
  expect(skill).toContain("Generic skills belong to `kriscard/Skills`");
  expect(skill).toContain("Ask for explicit approval");
  expect(skill).toContain("approved handoff to `kriscard/Skills`");
  expect(skill).toContain("references/quality-benchmark.md");
  expect(skill).toContain(
    "Stop using jargon when not necessary and speak coherently. State it more simply and concisely, like one human talking or writing to another",
  );
  expect(skill).toContain("Candidate names must state the action clearly");
  expect(skill).toContain("Avoid abstract noun stacks, compressed slogans, and metaphors");
});

test("benchmarks generated principles and playbooks against the complete Pstack corpus", async () => {
  const benchmark = await readFile(qualityBenchmark, "utf8");

  expect(benchmark).toContain("all 24 `principle-*` skills");
  expect(benchmark).toContain("all 23 Poteto mode playbooks");
  expect(benchmark).toContain("quality benchmarks, not material to copy");
  expect(benchmark).toContain("Choose a **principle** for one reusable decision rule");
  expect(benchmark).toContain("Choose a **playbook** for one complete kind of work");
  expect(benchmark).toContain("Choose a **generic skill** for one recurring user job");
  expect(benchmark).toContain("a substantive, durable engineering belief stated by the user");
  expect(benchmark).toContain("What bad default does it replace?");
  expect(benchmark).toContain("Is this an observed workflow or an inferred one?");
  expect(benchmark).toContain("Why are the current playbooks not enough?");
  expect(benchmark).toContain("Which existing skills were inspected?");
  expect(benchmark).toContain("Compare before shortlisting");
  expect(benchmark).toContain("Remove an idea when an existing artifact already handles it well");
});

test("routes orchestration to the Kstack-owned skill without copying Herdr", async () => {
  const skill = await readFile(resolve(orchestratorRoot, "SKILL.md"), "utf8");

  const playbook = await readFile(
    resolve(skillsRoot, "dev/kriscard-mode/playbooks/orchestration.md"),
    "utf8",
  );

  expect(skill).toContain("Load the installed `herdr` skill");
  expect(skill).toContain("Kstack does not copy or cache its commands");
  expect(skill).not.toMatch(/herdr (?:agent start|pane split|workspace create)/);
  expect(playbook).toContain("[`kstack-orchestrator`](../../kstack-orchestrator/SKILL.md)");
  expect(playbook).not.toContain("does not provide");
});

test("defines bounded worker and verifier handoffs", async () => {
  const contracts = await readFile(
    resolve(orchestratorRoot, "references/worker-contracts.md"),
    "utf8",
  );

  for (const heading of [
    "## Task packet",
    "## Targeted amendment",
    "## Result packet",
    "## Verifier packet",
  ]) {
    expect(contracts).toContain(heading);
  }

  expect(contracts).toContain("parent conversation history or deliberation");
  expect(contracts).toContain("Target revision: <exact commit SHA or bounded diff>");
  expect(contracts).toContain("Do not return a transcript");
  expect(contracts).toContain("KSTACK_RESULT_<unique-token>");
});

test("covers the approved orchestration decision boundaries", async () => {
  // SAFETY: The checked-in evaluation fixture is validated by the assertions below.
  const evaluation = JSON.parse(
    await readFile(resolve(orchestratorRoot, "evals/cases.json"), "utf8"),
  ) as { schemaVersion: number; skill: string; cases: Array<{ id: string }> };

  expect(evaluation.schemaVersion).toBe(1);
  expect(evaluation.skill).toBe("kstack-orchestrator");
  expect(evaluation.cases.map(({ id }) => id)).toEqual([
    "single-outcome-stays-parent",
    "independent-readers-share-checkout",
    "independent-writers-use-worktrees",
    "dependent-work-is-serialized",
    "conflicting-paths-are-serialized",
    "missing-herdr-blocks-only-orchestration",
    "missing-live-capability-stops",
    "worker-crash-preserves-state",
    "targeted-update-only",
    "bounded-worker-context",
    "bounded-synthesis",
    "exact-revision-verification",
  ]);
});
