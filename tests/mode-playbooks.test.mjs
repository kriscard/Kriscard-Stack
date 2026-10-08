import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const modeDirectory = join(root, "skills", "dev", "kriscard-mode");
const playbookDirectory = join(modeDirectory, "playbooks");
const generalSkillsRoot =
  process.env.KRISCARD_SKILLS_REPO ?? resolve(root, "../Skills");

const expectedPlaybooks = new Map([
  ["feature", "Mutating"],
  ["bug-fix", "Mutating"],
  ["refactor", "Mutating"],
  ["migration", "Mutating"],
  ["investigation", "Read-only"],
  ["review", "Read-only"],
  ["release", "Mutating"],
  ["orchestration", "Mutating"],
]);

/** @param {string} path */
async function text(path) {
  return readFile(path, "utf8");
}

async function installedGeneralSkillNames() {
  const categories = await readdir(join(generalSkillsRoot, "skills"), {
    withFileTypes: true,
  });
  const names = new Set();
  for (const category of categories.filter((entry) => entry.isDirectory())) {
    const skills = await readdir(
      join(generalSkillsRoot, "skills", category.name),
      { withFileTypes: true },
    );
    for (const skill of skills.filter((entry) => entry.isDirectory())) {
      const skillFile = join(
        generalSkillsRoot,
        "skills",
        category.name,
        skill.name,
        "SKILL.md",
      );
      let contents;
      try {
        contents = await text(skillFile);
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          continue;
        }
        throw error;
      }
      const name = contents.match(/^name:\s*(.+)$/m)?.[1].trim();
      if (name) names.add(name);
    }
  }
  return names;
}

/** @param {string} contents */
function linkedPlaybooks(contents) {
  return [...contents.matchAll(/\]\(playbooks\/([a-z-]+)\.md\)/g)].map(
    ([, name]) => name,
  );
}

/** @param {string} contents */
function declaredDependencies(contents) {
  const section = contents.match(
    /## Required handoffs?\n([\s\S]*?)(?=\n## |$)/,
  )?.[1];
  assert.ok(section, "playbook must contain a required handoff section");
  return [...section.matchAll(/`([a-z][a-z0-9-]+)`/g)].map(([, name]) => name);
}

test("kriscard-mode reaches exactly the eight approved playbooks", async () => {
  const mode = await text(join(modeDirectory, "SKILL.md"));
  const links = linkedPlaybooks(mode);
  const files = (await readdir(playbookDirectory))
    .filter((file) => file.endsWith(".md"))
    .map((file) => file.slice(0, -3));

  assert.deepEqual(
    [...new Set(links)].sort(),
    [...expectedPlaybooks.keys()].sort(),
  );
  assert.equal(
    links.length,
    expectedPlaybooks.size,
    "each playbook is linked once",
  );
  assert.deepEqual(files.sort(), [...expectedPlaybooks.keys()].sort());
});

test("every playbook declares and honors its side-effect class", async () => {
  for (const [name, sideEffectClass] of expectedPlaybooks) {
    const contents = await text(join(playbookDirectory, `${name}.md`));
    assert.match(contents, /> \*\*Read this when:\*\*/);
    assert.match(
      contents,
      new RegExp(
        `> \\*\\*Side-effect class:\\*\\* ${sideEffectClass.replace("-", "-")}`,
      ),
    );

    if (sideEffectClass === "Read-only") {
      assert.match(contents, /Do not edit/i);
      assert.match(contents, /route the new (?:mutating )?request/i);
      assert.doesNotMatch(contents, /Require approved `spec\.md`/);
    } else {
      assert.match(
        contents,
        /Require approved `spec\.md`, `plan\.md`, and `approval\.md`/,
      );
      assert.match(contents, /matching recorded hashes/);
      assert.match(contents, /unchanged/);
      assert.match(contents, /stop/i);
    }
  }
});

test("routing contract covers each playbook and refuses ambiguous intent", async () => {
  const mode = await text(join(modeDirectory, "SKILL.md"));
  const evidence = [
    ["feature", "product behavior not covered above"],
    ["bug-fix", "correct observed behavior"],
    ["refactor", "preserving observable behavior"],
    [
      "migration",
      "move data, schemas, dependencies, platforms, APIs, or ownership",
    ],
    ["investigation", "explain, research, audit, or diagnose"],
    ["review", "evaluate existing code or a diff"],
    ["release", "publish, deploy, tag, distribute, or promote"],
    ["orchestration", "coordinate multiple independently reviewable goals"],
  ];

  for (const [name, phrase] of evidence) {
    assert.ok(
      mode.toLowerCase().includes(phrase.toLowerCase()),
      `${name} lacks explicit routing evidence`,
    );
  }
  assert.match(mode, /ask one question that distinguishes them/i);
  assert.match(mode, /Do not select a route[\s\S]*until the answer resolves/i);
  assert.match(mode, /Select exactly one playbook/);
});

test("mutating routes stop at the approved spec boundary", async () => {
  const mode = await text(join(modeDirectory, "SKILL.md"));
  assert.match(mode, /It is user-invoked/);
  assert.match(mode, /present the exact `\/spec <request>` handoff/);
  assert.match(mode, /do not claim to invoke it on the user's behalf/);
  assert.match(mode, /recompute the SHA-256 hashes/);
  assert.match(mode, /require them to match `approval\.md`/);
  assert.match(mode, /Report the approved artifact paths and stop/);
  assert.match(mode, /Kriscard Mode does not continue into mutation/);
});

test("named handoffs exist at the exact compatible general Skills revision", async () => {
  const manifest = JSON.parse(
    await text(join(root, "config", "skills-source.json")),
  );
  assert.equal(manifest.revision, "158a5e919605d8611dbbe83a6217b5a3d118f7f7");

  const installed = await installedGeneralSkillNames();
  for (const name of expectedPlaybooks.keys()) {
    const contents = await text(join(playbookDirectory, `${name}.md`));
    for (const dependency of declaredDependencies(contents)) {
      assert.ok(
        installed.has(dependency),
        `${name} names unavailable general skill ${dependency}`,
      );
    }
    assert.match(contents, /missing|absence/i);
    assert.match(contents, /stop|blocker/i);
  }
});

test("plain-skills mode does not claim durable runtime behavior", async () => {
  const mode = await text(join(modeDirectory, "SKILL.md"));
  assert.match(mode, /cannot provide crash-safe state/);
  assert.match(
    mode,
    /Ordinary chat or terminal state is not a durable substitute/,
  );

  const orchestration = await text(join(playbookDirectory, "orchestration.md"));
  assert.match(orchestration, /absence[\s\S]*blocks worker launch/i);
  assert.match(orchestration, /not crash-safe orchestration/i);
});
