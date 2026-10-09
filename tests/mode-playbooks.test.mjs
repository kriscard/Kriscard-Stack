import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { onTestFinished, test } from "vitest";

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

const generalHandoffs = {
  feature: ["spec"],
  "bug-fix": ["debug", "test", "spec"],
  refactor: ["refactor", "test", "spec"],
  migration: ["research", "test", "architect", "spec"],
  investigation: ["debug", "research", "analyze-repo", "architect"],
  review: ["pr-review", "review"],
  release: ["research", "test"],
  orchestration: ["architect", "spec"],
};

/** @param {string} path */
async function text(path) {
  return readFile(path, "utf8");
}

/** @param {string} contents */
function linkedPlaybooks(contents) {
  return [...contents.matchAll(/\]\(playbooks\/([a-z-]+)\.md\)/g)].map(
    ([, name]) => name,
  );
}

async function installedGeneralSkillNames() {
  const names = new Set();
  const categories = await readdir(join(generalSkillsRoot, "skills"), {
    withFileTypes: true,
  });
  for (const category of categories.filter((entry) => entry.isDirectory())) {
    const skills = await readdir(
      join(generalSkillsRoot, "skills", category.name),
      {
        withFileTypes: true,
      },
    );
    for (const skill of skills.filter((entry) => entry.isDirectory())) {
      const path = join(
        generalSkillsRoot,
        "skills",
        category.name,
        skill.name,
        "SKILL.md",
      );
      try {
        const name = (await text(path)).match(/^name:\s*(.+)$/m)?.[1].trim();
        if (name) names.add(name);
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
    }
  }
  return names;
}

/** @param {string} prefix */
async function temporaryDirectory(prefix) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  return directory;
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
  assert.equal(links.length, expectedPlaybooks.size);
  assert.deepEqual(files.sort(), [...expectedPlaybooks.keys()].sort());
});

test("each playbook has a distinct owned output and checkable stage bounds", async () => {
  const outputs = new Set();
  for (const [name, sideEffectClass] of expectedPlaybooks) {
    const contents = await text(join(playbookDirectory, `${name}.md`));
    assert.match(contents, /> \*\*Read this when:\*\*/);
    assert.match(
      contents,
      new RegExp(`> \\*\\*Side-effect class:\\*\\* ${sideEffectClass}`),
    );
    assert.match(contents, /## Lead responsibility/);
    assert.match(contents, /\*\*Complete when:\*\*/);
    const output = contents.match(/\*\*Output:\*\* (.+)$/m)?.[1];
    assert.ok(output, `${name} must define its observable output`);
    assert.ok(
      !outputs.has(output),
      `${name} duplicates another playbook output`,
    );
    outputs.add(output);

    if (sideEffectClass === "Mutating") {
      const phases = [
        ...contents.matchAll(/## Phase [A-Z][\s\S]*?(?=\n## |$)/g),
      ].map(([phase]) => phase);
      assert.ok(
        phases.length >= 2,
        `${name} must separate approval from approved work`,
      );
      for (const phase of phases) {
        assert.match(phase, /\*\*Complete when:\*\*/);
      }
      assert.match(contents, /approved|approval/i);
    }
  }
});

test("the router owns one canonical approval and delivery lifecycle", async () => {
  const mode = await text(join(modeDirectory, "SKILL.md"));
  assert.match(mode, /## 4\. Shared mutating-work contract/);
  assert.match(mode, /### Phase A — Obtain or validate approval/);
  assert.match(mode, /### Phase B — Execute approved increments/);
  assert.match(mode, /### Phase C — Verify the exact revision independently/);
  assert.match(mode, /### Phase D — Human acceptance and ordered landing/);
  assert.match(
    mode,
    /select the release playbook in a later landing invocation/i,
  );
  assert.match(
    mode,
    /Before every merge it rechecks PR identity, expected base\/head/,
  );
  assert.match(
    mode,
    /applicable PR identity and exact head\/base or external-action receipt/,
  );

  for (const [name, sideEffectClass] of expectedPlaybooks) {
    if (sideEffectClass === "Read-only") continue;
    const contents = await text(join(playbookDirectory, `${name}.md`));
    assert.doesNotMatch(contents, /SHA-256|approval\.md|spec\.md/);
  }
});

test("routing distinguishes explanation, feature increments, orchestration, and landing", async () => {
  const mode = await text(join(modeDirectory, "SKILL.md"));
  const releasePosition = mode.indexOf("1. **Release**");
  const orchestrationPosition = mode.indexOf("2. **Orchestration**");
  assert.ok(releasePosition > 0 && releasePosition < orchestrationPosition);
  assert.match(mode, /“Ship these approved PRs” is release/);
  assert.match(
    mode,
    /feature remains feature when its approved implementation has several dependent steps/i,
  );
  assert.match(mode, /new or existing application/);

  const investigation = await text(join(playbookDirectory, "investigation.md"));
  assert.match(investigation, /\*\*Scoped explanation:\*\*/);
  assert.match(investigation, /immediate callers and callees/);
  assert.match(investigation, /No separate “how” skill is assumed/);
  assert.match(investigation, /cited paths and symbols/);
});

test("premature mutation, stale proof, and implicit merge permission are refused", async () => {
  const mode = await text(join(modeDirectory, "SKILL.md"));
  const approvalPhase = mode.match(
    /### Phase A — Obtain or validate approval([\s\S]*?)### Phase B/,
  )?.[1];
  assert.ok(approvalPhase);
  assert.match(approvalPhase, /Preserve[\s\S]*unchanged/);
  assert.match(approvalPhase, /Present `\/spec <request>`/);
  assert.match(approvalPhase, /stop this invocation/);

  assert.match(
    mode,
    /changed head, changed base, changed lower stack layer[\s\S]*`stale` or `blocked`/i,
  );
  assert.match(mode, /After explicit \*\*merge permission\*\*/);
  assert.match(mode, /silence/);
  assert.match(
    mode,
    /Never auto-merge, enable auto-merge, force-push, silently rebase or restack/,
  );

  const release = await text(join(playbookDirectory, "release.md"));
  assert.match(
    release,
    /approval and verification are evidence, not merge permission/i,
  );
  assert.match(
    release,
    /Stop at any unverified dependency, stale head or base/i,
  );
});

test("missing capabilities block only the stage that needs them", async () => {
  const mode = await text(join(modeDirectory, "SKILL.md"));
  assert.match(
    mode,
    /blocks that stage, not unrelated completed stages or all future work/,
  );
  assert.match(mode, /resume from valid approved evidence/i);

  const migration = await text(join(playbookDirectory, "migration.md"));
  const orchestration = await text(join(playbookDirectory, "orchestration.md"));
  assert.match(migration, /Consult `architect` only when/);
  assert.match(orchestration, /Consult general `architect` only when/);
  assert.match(
    orchestration,
    /may explicitly authorize available owners[\s\S]*manually/i,
  );
  assert.match(orchestration, /status as non-durable/i);
});

test("named handoffs exist at the checked-out compatible Skills revision", async () => {
  const manifest = JSON.parse(
    await text(join(root, "config", "skills-source.json")),
  );
  const actualRevision = execFileSync(
    "git",
    ["-C", generalSkillsRoot, "rev-parse", "HEAD"],
    { encoding: "utf8" },
  ).trim();
  assert.equal(actualRevision, manifest.revision);

  const installed = await installedGeneralSkillNames();
  for (const [playbook, handoffs] of Object.entries(generalHandoffs)) {
    const contents = await text(join(playbookDirectory, `${playbook}.md`));
    for (const handoff of handoffs) {
      assert.ok(
        installed.has(handoff),
        `${handoff} is absent from general Skills`,
      );
      assert.match(contents, new RegExp(`\\\`${handoff}\\\``));
    }
  }
});

test("joint validation rejects a Skills checkout at the wrong revision", async () => {
  const repository = await temporaryDirectory("kriscard-wrong-skills-");
  const skillDirectory = join(repository, "skills", "dev", "fixture");
  await mkdir(skillDirectory, { recursive: true });
  await writeFile(
    join(skillDirectory, "SKILL.md"),
    "---\nname: fixture\ndescription: Fixture.\n---\n\n# Fixture\n",
  );
  execFileSync("git", ["init", "-q", repository]);
  execFileSync("git", ["-C", repository, "config", "user.name", "Test"]);
  execFileSync("git", [
    "-C",
    repository,
    "config",
    "user.email",
    "test@example.invalid",
  ]);
  execFileSync("git", ["-C", repository, "add", "."]);
  execFileSync("git", [
    "-c",
    "commit.gpgsign=false",
    "-C",
    repository,
    "commit",
    "-qm",
    "fixture",
  ]);

  const result = spawnSync(
    process.execPath,
    [join(root, "scripts", "validate-skill-catalog.mjs")],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, KRISCARD_SKILLS_REPO: repository },
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /Skills checkout is [0-9a-f]{40}; expected [0-9a-f]{40}/,
  );
});

test("plain-skills mode permits honest manual work but not fabricated durability", async () => {
  const mode = await text(join(modeDirectory, "SKILL.md"));
  assert.match(mode, /execute an approved task manually/);
  assert.match(mode, /cannot claim automatic frontier scheduling/);
  assert.match(mode, /independent verification that did not occur/);
  assert.match(mode, /actual available owner and explicit operator permission/);
});
