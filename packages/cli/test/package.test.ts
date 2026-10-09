import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "vitest";

const execute = promisify(execFile);

test("the packed CLI reaches read-only setup through both npx and pnpm dlx", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "kriscard-bootstrap-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const inheritedEnv: NodeJS.ProcessEnv = { ...process.env };
  // An outer npm exec --call must not become a conflicting flag for nested npx.
  delete inheritedEnv.npm_config_call;
  const env = {
    ...inheritedEnv,
    COREPACK_ENABLE_NETWORK: "0",
    COREPACK_HOME:
      process.env.COREPACK_HOME ?? path.join(homedir(), ".cache/node/corepack"),
    npm_config_offline: "true",
    npm_config_store_dir: path.join(root, "store"),
    npm_config_cache: path.join(root, "npm-cache"),
    XDG_CACHE_HOME: path.join(root, "cache"),
  };
  const packageRoot = fileURLToPath(new URL("..", import.meta.url));
  const packed = await execute(
    "npm",
    ["pack", "--ignore-scripts", "--json", "--pack-destination", root],
    { cwd: packageRoot, env, timeout: 30_000, maxBuffer: 256 * 1024 },
  );
  const metadata = JSON.parse(packed.stdout) as Array<{
    filename: string;
    files: Array<{ path: string }>;
  }>;
  const archive = path.join(root, metadata[0]!.filename);
  assert.ok(metadata[0]!.files.some((file) => file.path === "dist/bin.js"));
  assert.ok(
    metadata[0]!.files.every(
      (file) =>
        file.path === "package.json" ||
        file.path === "README.md" ||
        file.path.startsWith("dist/"),
    ),
  );

  const home = path.join(root, "home");
  const stack = path.join(root, "stack");
  const general = path.join(root, "general");
  await mkdir(home);
  for (const [directory, name] of [
    [stack, "setup-kriscard-stack"],
    [general, "general-test"],
  ]) {
    await mkdir(path.join(directory!, "skills"), { recursive: true });
    await writeFile(
      path.join(directory!, "skills", "SKILL.md"),
      `---\nname: ${name}\ndescription: Fixture\n---\n`,
    );
  }
  const installed = path.join(root, "installed");
  await mkdir(installed);
  await symlink(path.join(stack, "skills"), path.join(installed, "setup"));
  await symlink(path.join(general, "skills"), path.join(installed, "general"));
  await execute("git", ["init", "-q", general]);
  await execute("git", ["-C", general, "add", "."]);
  await execute("git", [
    "-C",
    general,
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
  const revision = (
    await execute("git", ["-C", general, "rev-parse", "HEAD"])
  ).stdout.trim();
  await mkdir(path.join(stack, "config"));
  await writeFile(
    path.join(stack, "config", "skills-source.json"),
    JSON.stringify({
      repository: "https://github.com/kriscard/Skills.git",
      revision,
    }),
  );
  const args = [
    "setup",
    "--stack",
    stack,
    "--skills",
    general,
    "--home",
    home,
    "--installed-skills",
    installed,
    "--host",
    "pi",
    "--mode",
    "plain-skills",
    "--retention-days",
    "30",
    "--dry-run",
  ];
  for (const [command, prefix] of [
    ["npx", ["--offline", "--yes", "--package", archive, "kriscard-stack"]],
    ["pnpm", ["dlx", archive]],
  ] as const) {
    const result = await execute(command, [...prefix, ...args], {
      cwd: root,
      env,
      timeout: 45_000,
      maxBuffer: 256 * 1024,
    });
    assert.match(result.stdout, /Proposed destination/);
    assert.match(result.stdout, /No settings changed/);
    assert.deepEqual(await readdir(home), []);
  }
}, 120_000);
