import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const skillsRoot = resolve(root, "skills");

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

test("validates skill metadata and unique folder-matching names", async () => {
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
