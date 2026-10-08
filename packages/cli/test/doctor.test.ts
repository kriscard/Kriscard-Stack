import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";

import { doctor, type DoctorOptions } from "../src/doctor.js";

async function fixture(t: { onTestFinished(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(path.join(tmpdir(), "kriscard-doctor-"));
  t.onTestFinished(() => rm(root, { recursive: true, force: true }));
  const stackRepository = path.join(root, "stack");
  const generalRepository = path.join(root, "general");
  await mkdir(path.join(stackRepository, "config"), { recursive: true });
  await mkdir(path.join(stackRepository, "skills", "setup"), {
    recursive: true,
  });
  await mkdir(path.join(generalRepository, "skills", "test"), {
    recursive: true,
  });
  await writeFile(
    path.join(stackRepository, "skills", "setup", "SKILL.md"),
    "---\nname: setup-kriscard-stack\ndescription: Setup\n---\n",
  );
  const generalSkill = path.join(
    generalRepository,
    "skills",
    "test",
    "SKILL.md",
  );
  await writeFile(generalSkill, "---\nname: test\ndescription: Test\n---\n");
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
  const manifest = path.join(stackRepository, "config", "skills-source.json");
  await writeFile(
    manifest,
    JSON.stringify({
      repository: "https://github.com/kriscard/Skills.git",
      revision,
    }),
  );
  const options: DoctorOptions = {
    stackRepository,
    generalRepository,
    platform: "darwin",
    nodeVersion: "24.15.0",
    probeTool: async () => true,
  };
  return { options, manifest, generalSkill, root };
}

test("doctor checks compatible sources without writing or launching a runtime", async (t) => {
  const { options, manifest, generalSkill } = await fixture(t);
  const before = await Promise.all([
    readFile(manifest, "utf8"),
    readFile(generalSkill, "utf8"),
  ]);
  const first = await doctor(options);
  const second = await doctor(options);
  assert.equal(first.ok, true);
  assert.deepEqual(second, first);
  assert.deepEqual(
    await Promise.all([
      readFile(manifest, "utf8"),
      readFile(generalSkill, "utf8"),
    ]),
    before,
  );
  assert.equal(
    execFileSync(
      "git",
      ["-C", options.generalRepository, "status", "--porcelain"],
      { encoding: "utf8" },
    ),
    "",
  );
});

test("doctor reports missing, mismatched, and modified skill sources", async (t) => {
  const { options, manifest, generalSkill } = await fixture(t);
  await writeFile(
    manifest,
    JSON.stringify({
      repository: "https://github.com/kriscard/Skills.git",
      revision: "0".repeat(40),
    }),
  );
  const mismatched = await doctor(options);
  assert.equal(mismatched.ok, false);
  assert.match(
    mismatched.diagnostics.find((entry) => entry.id === "compatibility")!
      .message,
    /does not match/,
  );
  const revision = execFileSync(
    "git",
    ["-C", options.generalRepository, "rev-parse", "HEAD"],
    { encoding: "utf8" },
  ).trim();
  await writeFile(
    manifest,
    JSON.stringify({
      repository: "https://github.com/kriscard/Skills.git",
      revision,
    }),
  );
  await writeFile(generalSkill, "---\nname: modified\n---\n");
  const modified = await doctor(options);
  assert.equal(modified.ok, false);
  assert.match(
    modified.diagnostics.find((entry) => entry.id === "compatibility")!.message,
    /modified/,
  );
  const missing = await doctor({
    ...options,
    generalRepository: path.join(options.generalRepository, "missing"),
  });
  assert.equal(missing.ok, false);
  assert.equal(
    missing.diagnostics.find((entry) => entry.id === "catalog:general")!.status,
    "fail",
  );
});

test("duplicate source owners and installed names block setup", async (t) => {
  const { options, generalSkill, root } = await fixture(t);
  await writeFile(generalSkill, "---\nname: setup-kriscard-stack\n---\n");
  assert.equal(
    (await doctor(options)).diagnostics.find(
      (entry) => entry.id === "collisions",
    )!.status,
    "fail",
  );
  const installed = path.join(root, "installed");
  for (const folder of ["one", "two"]) {
    await mkdir(path.join(installed, folder), { recursive: true });
    await writeFile(
      path.join(installed, folder, "SKILL.md"),
      "---\nname: duplicate\n---\n",
    );
  }
  const result = await doctor({ ...options, installedSkillRoots: [installed] });
  assert.match(
    result.diagnostics.find((entry) => entry.id === "collisions")!.message,
    /duplicate/,
  );
});

test("optional tools remain warnings and unsafe remote observations fail", async (t) => {
  const { options } = await fixture(t);
  const local = await doctor({
    ...options,
    probeTool: async (tool) => tool === "git" || tool === "npm",
  });
  assert.equal(local.ok, true);
  assert.equal(
    local.diagnostics.find((entry) => entry.id === "tool:docker")!.status,
    "warning",
  );
  const result = await doctor({
    ...options,
    remote: {
      enabled: true,
      binding: "0.0.0.0",
      funnel: true,
      deviceApprovalVerified: false,
      leastPrivilegeVerified: false,
      strongIdentityVerified: false,
    },
  });
  assert.equal(result.ok, false);
  assert.equal(
    result.diagnostics.find((entry) => entry.id === "remote")!.status,
    "fail",
  );
  assert.ok(result.diagnostics.find((entry) => entry.id === "remote")!.fix);
});
