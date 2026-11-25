import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const bin = fileURLToPath(new URL("../dist/bin.js", import.meta.url));

function cli(root, args, more = {}) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 15000,
    env: { PATH: process.env.PATH, HOME: root, PI_CODING_AGENT_DIR: join(root, "pi"), ...more },
  });
}

test("native Pi arguments pass through without the removed worker integration", async () => {
  const root = await mkdtemp("/tmp/ks-cli-");

  try {
    const fakePi = join(root, "native-pi");
    await writeFile(
      fakePi,
      "#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)));\n",
      { mode: 0o755 },
    );

    for (const args of [
      ["--continue"],
      ["run", "--model", "example", "task"],
      ["pi", "--version"],
    ]) {
      const result = cli(root, args, { KSTACK_PI_BIN: fakePi });
      assert.equal(result.status, 0, result.stderr);
      const passed = JSON.parse(result.stdout);
      assert.deepEqual(
        passed.slice(-(args[0] === "run" ? 3 : 1)),
        args.slice(args[0] === "run" || args[0] === "pi" ? 1 : 0),
      );
      assert.equal(passed.includes("--print"), args[0] === "run");
      assert.match(passed.join(" "), /Kriscard mode is enabled/);
      assert.doesNotMatch(passed.join(" "), /Durable worker command:|backend command:/);
    }

    for (const args of [
      ["durable", "run", "do not execute"],
      ["agents", "list"],
    ]) {
      const result = cli(root, args);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /removed/);
    }

    await assert.rejects(stat(join(root, ".kstack")), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
