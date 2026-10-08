import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { onTestFinished, test } from "vitest";

import {
  collectSkills,
  duplicateSkills,
} from "../scripts/validate-skill-catalog.mjs";

async function temporaryTestRoot() {
  const root = await mkdtemp(join(tmpdir(), "kriscard-stack-catalog-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  return root;
}

/**
 * @param {string} root
 * @param {string} category
 * @param {string} directory
 * @param {string} name
 */
async function writeSkill(root, category, directory, name) {
  const skillDirectory = join(root, "skills", category, directory);
  await mkdir(skillDirectory, { recursive: true });
  await writeFile(
    join(skillDirectory, "SKILL.md"),
    `---\nname: ${name}\ndescription: Test skill.\n---\n\n# ${name}\n`,
  );
}

test("collectSkills lists nested skills by their frontmatter name", async () => {
  const root = await temporaryTestRoot();
  await writeSkill(root, "dev", "first", "first-skill");
  await writeSkill(root, "writing", "second", "second-skill");

  const skills = await collectSkills(root);

  assert.deepEqual(skills.map(({ name }) => name).sort(), [
    "first-skill",
    "second-skill",
  ]);
});

test("duplicateSkills reports names owned by both repositories", () => {
  const duplicates = duplicateSkills(
    [{ name: "shared", path: "skills/dev/shared/SKILL.md" }],
    [{ name: "shared", path: "skills/general/shared/SKILL.md" }],
  );

  assert.deepEqual(duplicates, [
    {
      name: "shared",
      paths: ["skills/dev/shared/SKILL.md", "skills/general/shared/SKILL.md"],
    },
  ]);
});

test("collectSkills rejects a skill without frontmatter", async () => {
  const root = await temporaryTestRoot();
  const skillDirectory = join(root, "skills", "dev", "broken");
  await mkdir(skillDirectory, { recursive: true });
  await writeFile(join(skillDirectory, "SKILL.md"), "# Broken\n");

  await assert.rejects(() => collectSkills(root), /has no YAML frontmatter/);
});
