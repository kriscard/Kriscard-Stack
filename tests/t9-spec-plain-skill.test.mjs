import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

import {
  collectSkills,
  duplicateSkills,
} from "../scripts/validate-skill-catalog.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generalSkillsRoot = path.resolve(
  process.env.KRISCARD_SKILLS_REPO ?? path.resolve(root, "../Skills"),
);
const stackSpecRoot = path.join(root, "skills/dev/spec");
const generalSpecRoot = path.join(generalSkillsRoot, "skills/dev/spec");

/**
 * @param {string} directory
 * @param {string} [prefix]
 * @returns {Promise<string[]>}
 */
async function relativeFilePaths(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relativePath = path.join(prefix, entry.name);
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await relativeFilePaths(absolutePath, relativePath)));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files.sort();
}

/** @param {string} skillFile */
async function skillName(skillFile) {
  const contents = await readFile(skillFile, "utf8");
  return contents.match(/^name:\s*(.+)$/m)?.[1].trim();
}

test("T9 plain spec skill exactly matches the pinned general Skills source", async () => {
  const manifest = JSON.parse(
    await readFile(path.join(root, "config/skills-source.json"), "utf8"),
  );
  const revision = execFileSync(
    "git",
    ["-C", generalSkillsRoot, "rev-parse", "HEAD"],
    { encoding: "utf8" },
  ).trim();
  assert.equal(revision, manifest.revision);
  assert.equal(
    execFileSync(
      "git",
      [
        "-C",
        generalSkillsRoot,
        "status",
        "--porcelain",
        "--",
        "skills/dev/spec",
      ],
      { encoding: "utf8" },
    ),
    "",
  );

  const sourceFiles = await relativeFilePaths(generalSpecRoot);
  const copiedFiles = await relativeFilePaths(stackSpecRoot);
  assert.deepEqual(copiedFiles, sourceFiles);
  assert.deepEqual(sourceFiles, [
    "SKILL.md",
    path.join("references", "approval-stage.md"),
    path.join("references", "design-stage.md"),
    path.join("references", "planning-stage.md"),
    path.join("references", "requirements-stage.md"),
    path.join("references", "source-and-discovery.md"),
  ]);

  for (const relativePath of sourceFiles) {
    assert.deepEqual(
      await readFile(path.join(stackSpecRoot, relativePath)),
      await readFile(path.join(generalSpecRoot, relativePath)),
      `${relativePath} differs from the pinned source`,
    );
  }
});

test("T9 plain fallback keeps the repository-local contract without durability claims", async () => {
  const skill = await readFile(path.join(stackSpecRoot, "SKILL.md"), "utf8");

  assert.match(skill, /docs\/specs\/<slug>\//);
  assert.match(
    skill,
    /Discover[\s\S]*Requirements[\s\S]*Design[\s\S]*Plan[\s\S]*Approve and stop/,
  );
  assert.match(skill, /Plannotator is the default/);
  assert.match(
    skill,
    /Implementation begins only through a separate workflow\./,
  );
  assert.doesNotMatch(skill, /Pi Durable|control plane|crash-safe/i);
});

test("T9 temporary spec duplicate is exact and remains unreleased", async () => {
  const packageManifest = JSON.parse(
    await readFile(path.join(root, "package.json"), "utf8"),
  );
  assert.equal(packageManifest.private, true);
  assert.equal(
    await skillName(path.join(stackSpecRoot, "SKILL.md")),
    await skillName(path.join(generalSpecRoot, "SKILL.md")),
  );

  const duplicates = duplicateSkills(
    await collectSkills(root),
    await collectSkills(generalSkillsRoot),
  );
  assert.deepEqual(duplicates.map(({ name }) => name).sort(), ["spec"]);
});
