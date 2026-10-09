import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { onTestFinished, test } from "vitest";

import {
  collectSkills,
  duplicateSkills,
  validateModePlaybooks,
} from "../scripts/validate-skill-catalog.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceModeDirectory = join(
  repositoryRoot,
  "skills",
  "dev",
  "kriscard-mode",
);

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

async function copyModeFixture() {
  const root = await temporaryTestRoot();
  const modeDirectory = join(root, "skills", "dev", "kriscard-mode");
  await cp(sourceModeDirectory, modeDirectory, { recursive: true });
  return {
    root,
    modeDirectory,
    playbooksDirectory: join(modeDirectory, "playbooks"),
  };
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

test("validateModePlaybooks accepts the eight routed playbooks", async () => {
  const { root } = await copyModeFixture();
  await validateModePlaybooks(root);
});

test("validateModePlaybooks rejects broken or duplicate routes", async () => {
  const broken = await copyModeFixture();
  const brokenRouterPath = join(broken.modeDirectory, "SKILL.md");
  const router = await readFile(brokenRouterPath, "utf8");
  await writeFile(
    brokenRouterPath,
    router.replace("playbooks/orchestration.md", "playbooks/missing.md"),
  );
  await assert.rejects(
    () => validateModePlaybooks(broken.root),
    /routes and files must match/,
  );

  const duplicate = await copyModeFixture();
  await writeFile(
    join(duplicate.modeDirectory, "SKILL.md"),
    `${router}\n[Duplicate](playbooks/feature.md)\n`,
  );
  await assert.rejects(
    () => validateModePlaybooks(duplicate.root),
    /Duplicate mode playbook links: feature/,
  );
});

test("validateModePlaybooks rejects orphan playbook files", async () => {
  const fixture = await copyModeFixture();
  await writeFile(join(fixture.playbooksDirectory, "orphan.md"), "# Orphan\n");

  await assert.rejects(
    () => validateModePlaybooks(fixture.root),
    /routes and files must match/,
  );
});

test("validateModePlaybooks requires read-when guidance and the approved class", async () => {
  const missingGuidance = await copyModeFixture();
  const investigationPath = join(
    missingGuidance.playbooksDirectory,
    "investigation.md",
  );
  await writeFile(
    investigationPath,
    (await readFile(investigationPath, "utf8")).replace(
      /^> \*\*Read this when:\*\*.*$/m,
      "> **Read this when:**",
    ),
  );
  await assert.rejects(
    () => validateModePlaybooks(missingGuidance.root),
    /investigation\.md requires read-when guidance/,
  );

  const wrongClass = await copyModeFixture();
  const reviewPath = join(wrongClass.playbooksDirectory, "review.md");
  await writeFile(
    reviewPath,
    (await readFile(reviewPath, "utf8")).replace(
      "> **Side-effect class:** Read-only.",
      "> **Side-effect class:** Mutating.",
    ),
  );
  await assert.rejects(
    () => validateModePlaybooks(wrongClass.root),
    /review\.md must be Read-only/,
  );
});
