import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const skillsRoot = resolve(root, "skills");
const orchestratorRoot = resolve(skillsRoot, "dev/kstack-orchestrator");

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
});

test("routes orchestration to the Kstack-owned skill without copying Herdr", async () => {
  const skill = await readFile(resolve(orchestratorRoot, "SKILL.md"), "utf8");
  const playbook = await readFile(
    resolve(skillsRoot, "dev/kriscard-mode/playbooks/orchestration.md"),
    "utf8",
  );

  expect(skill).toContain("Load the installed `herdr` skill");
  expect(skill).toContain("Kstack does not copy or cache its commands");
  expect(skill).not.toMatch(
    /herdr (?:agent start|pane split|workspace create)/,
  );
  expect(playbook).toContain(
    "[`kstack-orchestrator`](../../kstack-orchestrator/SKILL.md)",
  );
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
  expect(contracts).toContain(
    "Target revision: <exact commit SHA or bounded diff>",
  );
  expect(contracts).toContain("Do not return a transcript");
  expect(contracts).toContain("KSTACK_RESULT_<unique-token>");
});

test("covers the approved orchestration decision boundaries", async () => {
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
