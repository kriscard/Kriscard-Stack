import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { PassThrough } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSkills } from "@earendil-works/pi-coding-agent";
import { test } from "node:test";
import { applySetupPlan, createSetupPlan, formatSetupPlan, runCommand } from "../dist/installer.js";
import { main, parseCommand } from "../dist/cli.js";

const sources = {
  "kriscard/Skills": ["debug", "test"],
  "kriscard/Kriscard-Stack": ["kriscard-mode", "kstack-orchestrator"],
};

function skillListing(names) {
  return `Available Skills\n${names.map((name) => `│    ${name}`).join("\n")}\n`;
}

async function writeSkill(root, name) {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: Test fixture.\n---\n`);
}

function installerRunner(installed, onInstall = async () => {}) {
  return async (command, args) => {
    if (command === "kstack" || command === "kriscard" || command === "npm") {
      return { code: 0, stdout: "", stderr: "" };
    }

    assert.equal(command, "npx");

    if (args.includes("list")) {
      return { code: 0, stdout: JSON.stringify([...installed.values()]), stderr: "" };
    }

    assert.equal(args[2], "add");
    const source = args[3];
    const names = sources[source];
    assert.ok(names, `Unexpected skill source: ${source}`);

    if (args.includes("--list")) {
      return { code: 0, stdout: skillListing(names), stderr: "" };
    }

    for (const name of names) {
      installed.set(name, { name, source });
      await onInstall(name);
    }

    return { code: 0, stdout: "", stderr: "" };
  };
}

test("setup installs general skills, not a second copy of bundled Kstack skills", async () => {
  const plan = await createSetupPlan(installerRunner(new Map()));
  assert.deepEqual(plan.candidates, [
    { name: "debug", source: "kriscard/Skills" },
    { name: "test", source: "kriscard/Skills" },
  ]);
  assert.ok(!plan.commands.some((step) => step.args.includes("kriscard/Kriscard-Stack")));
  assert.deepEqual(plan.commands[0].args, ["install", "--global", "@kriscard/kstack@latest"]);
  assert.match(formatSetupPlan(plan, "Update"), /bundled/i);
});

test("repeated updates leave Pi's loaded skills collision-free and preserve unrelated skills", async () => {
  const root = await mkdtemp(join(tmpdir(), "kstack-update-"));

  try {
    const bundle = join(root, "bundle");
    const global = join(root, "global");

    for (const name of sources["kriscard/Kriscard-Stack"]) await writeSkill(bundle, name);
    await writeSkill(global, "unrelated");
    const installed = new Map([["unrelated", { name: "unrelated", source: "someone/else" }]]);
    const runner = installerRunner(installed, (name) => writeSkill(global, name));

    for (let update = 0; update < 2; update++) {
      const plan = await createSetupPlan(runner);
      await applySetupPlan(plan, runner, () => {});

      const result = loadSkills({
        cwd: root,
        includeDefaults: false,
        skillPaths: [bundle, global],
      });

      assert.deepEqual(result.diagnostics, [], `Update ${update + 1} introduced skill collisions`);
      assert.deepEqual(
        result.skills.map((skill) => skill.name).sort(),
        ["debug", "test", "unrelated", "kriscard-mode", "kstack-orchestrator"].sort(),
      );
      assert.deepEqual(installed.get("unrelated"), { name: "unrelated", source: "someone/else" });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an ownership conflict still blocks installation before any changes", async () => {
  const installed = new Map([["debug", { name: "debug", source: "someone/else" }]]);
  const runner = installerRunner(installed);
  const plan = await createSetupPlan(runner);
  assert.deepEqual(plan.conflicts, [
    { name: "debug", candidateSource: "kriscard/Skills", installedSource: "someone/else" },
  ]);
  await assert.rejects(
    applySetupPlan(plan, async () => assert.fail("must not run commands")),
    /ownership conflicts/,
  );
});

test("maintenance executes literal argv and preserves separate output and exit status", async () => {
  const argument = "literal; $(not-a-command) with spaces";

  const result = await runCommand(process.execPath, [
    "-e",
    "process.stdout.write(process.argv[1]); process.stderr.write('diagnostic'); process.exitCode=7;",
    argument,
  ]);

  assert.deepEqual(result, { code: 7, stdout: argument, stderr: "diagnostic" });
});

test("cancellation stops a running maintenance child", { timeout: 10000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "kstack-cancel-"));
  const controller = new AbortController();

  const running = runCommand(
    process.execPath,
    [
      "-e",
      "require('node:fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000);",
      join(root, "ready"),
    ],
    { signal: controller.signal },
  );

  const rejected = assert.rejects(running, /abort/i);

  try {
    let pid;
    const deadline = Date.now() + 5000;

    while (!pid && Date.now() < deadline) {
      try {
        pid = Number(await readFile(join(root, "ready"), "utf8"));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }

      if (!pid) await delay(10);
    }

    assert.ok(pid, "child must actually start before cancellation");
    controller.abort();
    await rejected;
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  } finally {
    controller.abort();
    await rejected;
    await rm(root, { recursive: true, force: true });
  }
});

test("plain setup and update preserve approval checks without runtime/version enforcement", async () => {
  for (const operation of ["setup", "update"]) {
    const output = new PassThrough();
    const error = new PassThrough();
    let text = "";
    output.on("data", (chunk) => {
      text += chunk;
    });
    const installed = new Map();
    assert.equal(
      await main([operation, "--yes", "--plain"], {
        input: new PassThrough(),
        output,
        error,
        commandRunner: installerRunner(installed),
      }),
      0,
    );
    assert.match(text, /complete/);
    assert.doesNotMatch(text, /Kstack \d/);
  }

  assert.deepEqual(parseCommand(["--version"]), {
    type: "pi",
    arguments: ["--version"],
    print: false,
  });
});
