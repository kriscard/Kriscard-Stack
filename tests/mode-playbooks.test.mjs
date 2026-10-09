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
import { describe, onTestFinished, test } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const modeDirectory = join(root, "skills", "dev", "kriscard-mode");
const playbookDirectory = join(modeDirectory, "playbooks");
const catalogValidator = join(root, "scripts", "validate-skill-catalog.mjs");
const generalSkillsRoot =
  process.env.KRISCARD_SKILLS_REPO ?? resolve(root, "../Skills");

/** @typedef {{ name: string, sideEffectClass: "Mutating" | "Read-only", handoffs: string[] }} PlaybookContract */

/** @type {PlaybookContract[]} */
const playbooks = [
  { name: "feature", sideEffectClass: "Mutating", handoffs: ["spec"] },
  {
    name: "bug-fix",
    sideEffectClass: "Mutating",
    handoffs: ["debug", "test", "spec"],
  },
  {
    name: "refactor",
    sideEffectClass: "Mutating",
    handoffs: ["refactor", "test", "spec"],
  },
  {
    name: "migration",
    sideEffectClass: "Mutating",
    handoffs: ["research", "test", "architect", "spec"],
  },
  {
    name: "investigation",
    sideEffectClass: "Read-only",
    handoffs: ["debug", "research", "analyze-repo", "architect"],
  },
  {
    name: "review",
    sideEffectClass: "Read-only",
    handoffs: ["pr-review", "review"],
  },
  {
    name: "release",
    sideEffectClass: "Mutating",
    handoffs: ["research", "test"],
  },
  {
    name: "orchestration",
    sideEffectClass: "Mutating",
    handoffs: ["architect", "spec"],
  },
];

const playbookNames = playbooks.map(({ name }) => name);

/** Reads the Kriscard Mode router document. */
function readMode() {
  return readFile(join(modeDirectory, "SKILL.md"), "utf8");
}

/** @param {string} name */
function readPlaybook(name) {
  return readFile(join(playbookDirectory, `${name}.md`), "utf8");
}

/** @param {string} contents */
function linkedPlaybooks(contents) {
  return [...contents.matchAll(/\]\(playbooks\/([a-z-]+)\.md\)/g)].map(
    ([, name]) => name,
  );
}

/** @param {string} contents */
function phaseSections(contents) {
  return [...contents.matchAll(/## Phase [A-Z][\s\S]*?(?=\n## |$)/g)].map(
    ([phase]) => phase,
  );
}

/** Collects the installed general skill names from the pinned checkout. */
async function installedGeneralSkillNames() {
  const names = new Set();
  const skillsDirectory = join(generalSkillsRoot, "skills");
  const categories = await readdir(skillsDirectory, { withFileTypes: true });

  for (const category of categories) {
    if (!category.isDirectory()) continue;
    const categoryDirectory = join(skillsDirectory, category.name);
    const skills = await readdir(categoryDirectory, { withFileTypes: true });

    for (const skill of skills) {
      if (!skill.isDirectory()) continue;
      try {
        const contents = await readFile(
          join(categoryDirectory, skill.name, "SKILL.md"),
          "utf8",
        );
        const name = contents.match(/^name:\s*(.+)$/m)?.[1].trim();
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

/**
 * @param {string} repository
 * @param {string[]} args
 */
function git(repository, args) {
  return execFileSync(
    "git",
    ["-c", "commit.gpgsign=false", "-C", repository, ...args],
    { encoding: "utf8" },
  ).trim();
}

/** Builds and validates a disposable Skills checkout at the wrong revision. */
async function validateWrongRevisionCheckout() {
  const repository = await mkdtemp(join(tmpdir(), "kriscard-wrong-skills-"));
  onTestFinished(() => rm(repository, { recursive: true, force: true }));

  const skillDirectory = join(repository, "skills", "dev", "fixture");
  await mkdir(skillDirectory, { recursive: true });
  await writeFile(
    join(skillDirectory, "SKILL.md"),
    "---\nname: fixture\ndescription: Fixture.\n---\n\n# Fixture\n",
  );
  git(repository, ["init", "-q"]);
  git(repository, ["config", "user.name", "Test"]);
  git(repository, ["config", "user.email", "test@example.invalid"]);
  git(repository, ["add", "."]);
  git(repository, ["commit", "-qm", "fixture"]);

  return spawnSync(process.execPath, [catalogValidator], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, KRISCARD_SKILLS_REPO: repository },
  });
}

describe("catalog and document structure", () => {
  test("kriscard-mode reaches exactly the eight approved playbooks", async () => {
    const links = linkedPlaybooks(await readMode());
    const files = (await readdir(playbookDirectory))
      .filter((file) => file.endsWith(".md"))
      .map((file) => file.slice(0, -3));

    assert.deepEqual([...new Set(links)].sort(), [...playbookNames].sort());
    assert.equal(links.length, playbooks.length);
    assert.deepEqual(files.sort(), [...playbookNames].sort());
  });

  test("each playbook has a distinct owned output and checkable stage bounds", async () => {
    const outputs = new Set();
    for (const { name, sideEffectClass } of playbooks) {
      const contents = await readPlaybook(name);
      assert.ok(
        contents.includes("> **Read this when:**"),
        `${name} must declare when it is read`,
      );
      assert.ok(
        contents.includes(`> **Side-effect class:** ${sideEffectClass}`),
        `${name} must declare its ${sideEffectClass} class`,
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
        const phases = phaseSections(contents);
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
});

describe("workflow and safety rules", () => {
  test("the router owns one canonical approval and delivery lifecycle", async () => {
    const mode = await readMode();
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

    for (const { name, sideEffectClass } of playbooks) {
      if (sideEffectClass === "Read-only") continue;
      assert.doesNotMatch(
        await readPlaybook(name),
        /SHA-256|approval\.md|spec\.md/,
      );
    }
  });

  test("routing distinguishes explanation, feature increments, orchestration, and landing", async () => {
    const mode = await readMode();
    const releasePosition = mode.indexOf("1. **Release**");
    const orchestrationPosition = mode.indexOf("2. **Orchestration**");
    assert.ok(releasePosition > 0 && releasePosition < orchestrationPosition);
    assert.match(mode, /“Ship these approved PRs” is release/);
    assert.match(
      mode,
      /feature remains feature when its approved implementation has several dependent steps/i,
    );
    assert.match(mode, /new or existing application/);

    const investigation = await readPlaybook("investigation");
    assert.match(investigation, /\*\*Scoped explanation:\*\*/);
    assert.match(investigation, /immediate callers and callees/);
    assert.match(investigation, /No separate “how” skill is assumed/);
    assert.match(investigation, /cited paths and symbols/);
  });

  test("premature mutation, stale proof, and implicit merge permission are refused", async () => {
    const mode = await readMode();
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

    const release = await readPlaybook("release");
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
    const mode = await readMode();
    assert.match(
      mode,
      /blocks that stage, not unrelated completed stages or all future work/,
    );
    assert.match(mode, /resume from valid approved evidence/i);

    const migration = await readPlaybook("migration");
    const orchestration = await readPlaybook("orchestration");
    assert.match(migration, /Consult `architect` only when/);
    assert.match(orchestration, /Consult general `architect` only when/);
    assert.match(
      orchestration,
      /may explicitly authorize available owners[\s\S]*manually/i,
    );
    assert.match(orchestration, /status as non-durable/i);
  });

  test("plain-skills mode permits honest manual work but not fabricated durability", async () => {
    const mode = await readMode();
    assert.match(mode, /execute an approved task manually/);
    assert.match(mode, /cannot claim automatic frontier scheduling/);
    assert.match(mode, /independent verification that did not occur/);
    assert.match(
      mode,
      /actual available owner and explicit operator permission/,
    );
  });
});

describe("general Skills compatibility", () => {
  test("named handoffs exist at the checked-out compatible Skills revision", async () => {
    const manifest = JSON.parse(
      await readFile(join(root, "config", "skills-source.json"), "utf8"),
    );
    assert.equal(
      git(generalSkillsRoot, ["rev-parse", "HEAD"]),
      manifest.revision,
    );

    const installed = await installedGeneralSkillNames();
    for (const { name, handoffs } of playbooks) {
      const contents = await readPlaybook(name);
      for (const handoff of handoffs) {
        assert.ok(
          installed.has(handoff),
          `${handoff} is absent from general Skills`,
        );
        assert.ok(
          contents.includes(`\`${handoff}\``),
          `${name} does not name ${handoff}`,
        );
      }
    }
  });

  test("joint validation rejects a Skills checkout at the wrong revision", async () => {
    const result = await validateWrongRevisionCheckout();

    assert.notEqual(result.status, 0);
    assert.match(
      result.stderr,
      /Skills checkout is [0-9a-f]{40}; expected [0-9a-f]{40}/,
    );
  });
});
