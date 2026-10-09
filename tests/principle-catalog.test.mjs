import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { afterEach, describe, test } from "vitest";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const generator = resolve(root, "scripts/generate-principle-catalog.mjs");
/** @type {string[]} */
const temporaryRoots = [];

/** @param {string} contents */
function frontmatterRecord(contents) {
  const frontmatter = contents.match(/^---\n([\s\S]*?)\n---\n/)?.[1];
  assert.ok(frontmatter, "principle skill must have frontmatter");

  const name = frontmatter.match(/^name:\s*(.+)$/m)?.[1].trim();
  const descriptionBlock = frontmatter.match(
    /^description:\s*>-\n((?:  .*\n?)*)/m,
  )?.[1];
  assert.ok(name, "principle skill must have a name");
  assert.ok(descriptionBlock, "principle skill must have a description");

  return {
    name,
    description: descriptionBlock
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join(" "),
  };
}

/** @param {string} repositoryRoot */
async function principleRecords(repositoryRoot) {
  const devRoot = resolve(repositoryRoot, "skills/dev");
  const directories = (await readdir(devRoot, { withFileTypes: true }))
    .filter(
      (entry) => entry.isDirectory() && entry.name.startsWith("principle-"),
    )
    .map((entry) => entry.name)
    .sort();

  return Promise.all(
    directories.map(async (directory) =>
      frontmatterRecord(
        await readFile(resolve(devRoot, directory, "SKILL.md"), "utf8"),
      ),
    ),
  );
}

async function fixtureRoot() {
  const fixture = await mkdtemp(resolve(tmpdir(), "principle-catalog-"));
  temporaryRoots.push(fixture);
  const names = [
    "boundary-discipline",
    "evidence-follows-the-commit",
    "minimize-context",
    "one-goal-per-pull-request",
    "prove-real-behavior",
    "stop-on-plan-drift",
  ];
  for (const [index, suffix] of names.entries()) {
    const name = `principle-${suffix}`;
    const directory = resolve(fixture, "skills/dev", name);
    await mkdir(directory, { recursive: true });
    await writeFile(
      resolve(directory, "SKILL.md"),
      `---\nname: ${name}\ndescription: >-\n  Fixture trigger ${index + 1} for ${name}.\n---\n\n# Fixture\n`,
    );
  }
  return fixture;
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("generated principle discovery catalog", () => {
  test("lists exactly the six authoritative principle names and descriptions", async () => {
    const records = await principleRecords(root);
    const catalog = await readFile(
      resolve(root, "skills/dev/PRINCIPLES.md"),
      "utf8",
    );

    assert.equal(records.length, 6);
    assert.deepEqual(
      [...catalog.matchAll(/^## `(principle-[^`]+)`$/gm)].map(
        ([, name]) => name,
      ),
      records.map(({ name }) => name),
    );
    for (const { name, description } of records) {
      assert.match(
        catalog,
        new RegExp(`\\[SKILL.md\\]\\(${name}/SKILL\\.md\\)`),
      );
      assert.ok(catalog.includes(description));
    }
  });

  test("generation is deterministic and check mode accepts current output", async () => {
    const fixture = await fixtureRoot();
    await execFileAsync(process.execPath, [generator, "--root", fixture]);
    const first = await readFile(
      resolve(fixture, "skills/dev/PRINCIPLES.md"),
      "utf8",
    );

    await execFileAsync(process.execPath, [generator, "--root", fixture]);
    const second = await readFile(
      resolve(fixture, "skills/dev/PRINCIPLES.md"),
      "utf8",
    );
    assert.equal(second, first);

    await execFileAsync(process.execPath, [
      generator,
      "--check",
      "--root",
      fixture,
    ]);
  });

  test("check mode rejects output stale against a source description", async () => {
    const fixture = await fixtureRoot();
    await execFileAsync(process.execPath, [generator, "--root", fixture]);
    const skill = resolve(
      fixture,
      "skills/dev/principle-boundary-discipline/SKILL.md",
    );
    await writeFile(
      skill,
      (await readFile(skill, "utf8")).replace(
        "Fixture trigger 1",
        "Changed fixture trigger",
      ),
    );

    await assert.rejects(
      execFileAsync(process.execPath, [
        generator,
        "--check",
        "--root",
        fixture,
      ]),
      (error) => {
        if (!error || typeof error !== "object" || !("stderr" in error)) {
          return false;
        }
        assert.match(String(error.stderr), /principle catalog is stale/i);
        return true;
      },
    );
  });
});
