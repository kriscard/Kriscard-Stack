import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmod,
  link,
  stat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

import { setup, type SetupOptions } from "../src/setup.js";

async function fixture(t: { onTestFinished(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(path.join(tmpdir(), "kriscard-setup-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, "home");
  const generalRepository = path.join(root, "general");
  const stackRepository = path.join(root, "stack");
  await mkdir(home);
  await mkdir(path.join(generalRepository, "skills"), { recursive: true });
  await writeFile(
    path.join(generalRepository, "skills", "SKILL.md"),
    "---\nname: general-test\n---\n",
  );
  await mkdir(path.join(stackRepository, "skills"), { recursive: true });
  await writeFile(
    path.join(stackRepository, "skills", "SKILL.md"),
    "---\nname: setup-kriscard-stack\n---\n",
  );
  execFileSync("git", ["init", "-q", generalRepository]);
  execFileSync("git", ["-C", generalRepository, "add", "."]);
  execFileSync("git", [
    "-C",
    generalRepository,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "fixture",
  ]);
  const revision = execFileSync(
    "git",
    ["-C", generalRepository, "rev-parse", "HEAD"],
    { encoding: "utf8" },
  ).trim();
  await mkdir(path.join(stackRepository, "config"));
  await writeFile(
    path.join(stackRepository, "config", "skills-source.json"),
    JSON.stringify({
      repository: "https://github.com/kriscard/Skills.git",
      revision,
    }),
  );
  const options: SetupOptions = {
    home,
    generalRepository,
    stackRepository,
    mode: "plain-skills",
    host: "pi",
    rawLogRetentionDays: 30,
    platform: "darwin",
    nodeVersion: "24.15.0",
    probeTool: async () => true,
  };
  return { root, options };
}

test("the actual CLI previews setup without writing in a noninteractive home", async (t) => {
  const { options } = await fixture(t);
  const bin = fileURLToPath(new URL("../dist/bin.js", import.meta.url));
  assert.match(
    execFileSync(process.execPath, [bin, "--help"], { encoding: "utf8" }),
    /doctor\|setup/,
  );
  const output = execFileSync(
    process.execPath,
    [
      bin,
      "setup",
      "--stack",
      options.stackRepository,
      "--skills",
      options.generalRepository,
      "--home",
      options.home,
      "--mode",
      "plain-skills",
      "--host",
      "pi",
      "--retention-days",
      "30",
      "--dry-run",
    ],
    { encoding: "utf8", timeout: 20_000 },
  );
  assert.match(output, /Proposed destination/);
  assert.match(output, /No settings changed/);
  assert.deepEqual(await readdir(options.home), []);
}, 25_000);

test("clean setup asks before writes and a second run changes nothing", async (t) => {
  const { options } = await fixture(t);
  const declined = await setup(options, async (proposal) => {
    assert.ok(proposal.changes.length);
    return false;
  });
  assert.equal(declined.applied, false);
  assert.deepEqual(await readdir(options.home), []);
  const applied = await setup(options, async () => true);
  assert.equal(applied.applied, true);
  assert.equal((await stat(applied.proposal.destination)).mode & 0o777, 0o600);
  assert.equal(
    (await stat(path.dirname(applied.proposal.destination))).mode & 0o777,
    0o700,
  );
  const first = await readFile(applied.proposal.destination, "utf8");
  const repeated = await setup(options, async () => {
    throw new Error("No-op must not request a write");
  });
  assert.equal(repeated.applied, false);
  assert.equal(await readFile(applied.proposal.destination, "utf8"), first);
});

test("existing unrelated settings survive and an exact backup is kept", async (t) => {
  const { options } = await fixture(t);
  const directory = path.join(options.home, ".config", "kriscard-stack");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const destination = path.join(directory, "config.json");
  const original = JSON.stringify({
    unrelated: { theme: "dark" },
    kriscardStack: { additive: 42 },
  });
  await writeFile(destination, original, { mode: 0o600 });
  const result = await setup(options, async () => true);
  assert.equal(result.applied, true);
  const data = JSON.parse(await readFile(destination, "utf8"));
  assert.deepEqual(data.unrelated, { theme: "dark" });
  assert.equal(data.kriscardStack.additive, 42);
  const backups = (await readdir(directory)).filter((name) =>
    name.startsWith("config.json.backup-"),
  );
  assert.equal(backups.length, 1);
  assert.equal(
    await readFile(path.join(directory, backups[0]!), "utf8"),
    original,
  );
  const entries = await readdir(directory);
  assert.equal(
    (
      await setup(options, async () => {
        throw new Error("An identical setup must not ask for confirmation");
      })
    ).applied,
    false,
  );
  assert.deepEqual(await readdir(directory), entries);
});

test("setup refuses future versions and remote-enabled existing settings without altering them", async (t) => {
  const { options } = await fixture(t);
  const directory = path.join(options.home, ".config", "kriscard-stack");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const destination = path.join(directory, "config.json");
  for (const settings of [
    { schemaVersion: 2 },
    { schemaVersion: 1, remote: { enabled: true } },
  ]) {
    const original = JSON.stringify({ kriscardStack: settings });
    await writeFile(destination, original, { mode: 0o600 });
    await assert.rejects(
      setup(options, async () => {
        throw new Error("Unsafe configuration must not request confirmation");
      }),
      /unsupported version|separate security verification/,
    );
    assert.equal(await readFile(destination, "utf8"), original);
  }
});

test("setup refuses shared directories, hard links, and occupied locks", async (t) => {
  const { options, root } = await fixture(t);
  const directory = path.join(options.home, ".config", "kriscard-stack");
  const destination = path.join(directory, "config.json");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o755);
  await assert.rejects(
    setup(options, async () => true),
    /must be private/,
  );
  await chmod(directory, 0o700);
  const outside = path.join(root, "unrelated.json");
  await writeFile(outside, "{}", { mode: 0o600 });
  await link(outside, destination);
  await assert.rejects(
    setup(options, async () => true),
    /no hard links/,
  );
  assert.equal(await readFile(outside, "utf8"), "{}");
  await rm(destination);
  execFileSync("mkfifo", [destination]);
  await assert.rejects(
    setup(options, async () => true),
    /small regular file/,
  );
  await rm(destination);
  await mkdir(path.join(directory, ".setup-lock"));
  await assert.rejects(
    setup(options, async () => true),
    (error) =>
      error instanceof Error && "code" in error && error.code === "EEXIST",
  );
  assert.deepEqual(await readdir(directory), [".setup-lock"]);
});

test("explicit Stow source is edited, never a guessed dotfiles directory", async (t) => {
  const { options, root } = await fixture(t);
  const source = path.join(root, "chosen-stow-package");
  await mkdir(source);
  const selected = { ...options, stowSource: source };
  const first = await setup(selected, async () => true);
  assert.equal(first.applied, true);
  assert.deepEqual(await readdir(options.home), []);
  assert.equal((await setup(selected, async () => true)).applied, false);
  const config = JSON.parse(await readFile(first.proposal.destination, "utf8"));
  assert.equal(config.kriscardStack.host, "pi");
});

test("changed settings during confirmation and unexpected links cannot be overwritten", async (t) => {
  const { options, root } = await fixture(t);
  const destination = path.join(
    options.home,
    ".config",
    "kriscard-stack",
    "config.json",
  );
  await assert.rejects(
    setup(options, async () => {
      await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      await writeFile(destination, '{"changed":true}');
      return true;
    }),
    /changed during confirmation/,
  );
  assert.equal(await readFile(destination, "utf8"), '{"changed":true}');
  await rm(path.join(options.home, ".config"), { recursive: true });
  const outside = path.join(root, "outside");
  await mkdir(outside);
  await symlink(outside, path.join(options.home, ".config"));
  await assert.rejects(
    setup(options, async () => true),
    /unexpected directory symlink/,
  );
  assert.deepEqual(await readdir(outside), []);
});
