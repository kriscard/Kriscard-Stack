import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
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
  const installed = path.join(root, "installed");
  await mkdir(installed);
  await symlink(
    path.join(stackRepository, "skills", "setup"),
    path.join(installed, "setup"),
  );
  await symlink(path.dirname(generalSkill), path.join(installed, "test"));
  const options: DoctorOptions = {
    installedSkillRoots: [installed],
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

test("doctor rejects missing, empty, or single-source installed roots", async (t) => {
  const { options, root } = await fixture(t);
  const empty = path.join(root, "empty-installation");
  await mkdir(empty);
  for (const installedSkillRoots of [undefined, [empty]]) {
    const request = { ...options };
    delete request.installedSkillRoots;
    assert.equal(
      (
        await doctor({
          ...request,
          ...(installedSkillRoots ? { installedSkillRoots } : {}),
        })
      ).ok,
      false,
    );
  }
  await symlink(
    path.join(options.generalRepository, "skills", "test"),
    path.join(empty, "test"),
  );
  const partial = await doctor({ ...options, installedSkillRoots: [empty] });
  assert.equal(partial.ok, false);
  assert.equal(
    partial.diagnostics.find((entry) => entry.id === "installed-sources")!
      .status,
    "fail",
  );
});

test("installed bundle comparison detects changed references, scripts, and extra files", async (t) => {
  const { options, root } = await fixture(t);
  const source = path.join(options.stackRepository, "skills", "setup");
  await mkdir(path.join(source, "references"));
  await mkdir(path.join(source, "scripts"));
  await writeFile(
    path.join(source, "references", "guide.md"),
    "Approved guidance",
  );
  await writeFile(
    path.join(source, "scripts", "run.mjs"),
    "export const approved = true;",
  );
  const installed = path.join(root, "copies");
  await mkdir(installed);
  await symlink(
    path.join(options.generalRepository, "skills", "test"),
    path.join(installed, "test"),
  );
  const copy = path.join(installed, "setup");
  await cp(source, copy, { recursive: true });
  const request = { ...options, installedSkillRoots: [installed] };
  assert.equal((await doctor(request)).ok, true);
  for (const file of ["references/guide.md", "scripts/run.mjs", "extra.md"]) {
    await writeFile(path.join(copy, file), "Different installed content");
    const result = await doctor(request);
    assert.equal(result.ok, false);
    assert.equal(
      result.diagnostics.find((entry) => entry.id === "installed-ownership")!
        .status,
      "fail",
    );
    await rm(copy, { recursive: true });
    await cp(source, copy, { recursive: true });
  }
  await rm(path.join(copy, "references", "guide.md"));
  assert.equal((await doctor(request)).ok, false);
  await rm(copy, { recursive: true });
  await cp(source, copy, { recursive: true });
  for (const target of [root, copy]) {
    await symlink(target, path.join(copy, "unsafe-link"));
    const unsafe = await doctor(request);
    assert.equal(unsafe.ok, false);
    assert.equal(
      unsafe.diagnostics.find((entry) => entry.id === "installed-ownership")!
        .status,
      "fail",
    );
    await rm(path.join(copy, "unsafe-link"));
  }
});

test("doctor rejects missing, relative, nonexistent, and stale saved source paths", async (t) => {
  const { options, root } = await fixture(t);
  const configurationFile = path.join(root, "saved.json");
  const current = {
    schemaVersion: 1,
    mode: "plain-skills",
    host: "pi",
    rawLogRetentionDays: 30,
    stackRepository: options.stackRepository,
    generalRepository: options.generalRepository,
  };
  for (const sourcePaths of [
    { stackRepository: undefined, generalRepository: undefined },
    { generalRepository: "../general" },
    { generalRepository: path.join(root, "absent") },
    { generalRepository: options.stackRepository },
  ]) {
    await writeFile(
      configurationFile,
      JSON.stringify({ kriscardStack: { ...current, ...sourcePaths } }),
    );
    const result = await doctor({ ...options, configurationFile });
    assert.equal(
      result.diagnostics.find((entry) => entry.id === "configuration")!.status,
      "fail",
    );
  }
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

test("installed copies from both hosts agree, but a conflicting global name fails", async (t) => {
  const { options, generalSkill, root } = await fixture(t);
  const first = path.join(root, "pi-skills");
  const second = path.join(root, "claude-skills");
  await mkdir(first);
  await mkdir(second);
  await symlink(path.dirname(generalSkill), path.join(first, "test"));
  await symlink(path.dirname(generalSkill), path.join(second, "test"));
  const installedSkillRoots = [first, second, ...options.installedSkillRoots!];
  assert.equal((await doctor({ ...options, installedSkillRoots })).ok, true);
  await rm(path.join(second, "test"));
  await mkdir(path.join(second, "test"));
  await writeFile(
    path.join(second, "test", "SKILL.md"),
    "---\nname: test\n---\nConflicting version\n",
  );
  const conflict = await doctor({ ...options, installedSkillRoots });
  assert.equal(conflict.ok, false);
  assert.equal(
    conflict.diagnostics.find((entry) => entry.id === "installed-ownership")!
      .status,
    "fail",
  );
  const uninspected = { ...options };
  delete uninspected.installedSkillRoots;
  assert.equal(
    (await doctor(uninspected)).diagnostics.find(
      (entry) => entry.id === "installed-ownership",
    )!.status,
    "fail",
  );
});

test("doctor inspects saved settings without trusting persisted security claims or exposing values", async (t) => {
  const { options, root } = await fixture(t);
  const configurationFile = path.join(root, "config.json");
  const settings = {
    stackRepository: options.stackRepository,
    generalRepository: options.generalRepository,
    schemaVersion: 1,
    mode: "plain-skills",
    host: "pi",
    rawLogRetentionDays: 30,
  };
  await writeFile(
    configurationFile,
    JSON.stringify({ kriscardStack: settings }),
    { mode: 0o600 },
  );
  assert.equal((await doctor({ ...options, configurationFile })).ok, true);
  const malformed = '{"privateDummyValue":"fixture-only",';
  await writeFile(configurationFile, malformed);
  const broken = await doctor({ ...options, configurationFile });
  assert.equal(broken.ok, false);
  assert.doesNotMatch(JSON.stringify(broken), /fixture-only/);
  assert.equal(await readFile(configurationFile, "utf8"), malformed);
  await writeFile(
    configurationFile,
    JSON.stringify({
      kriscardStack: {
        ...settings,
        remote: {
          enabled: true,
          binding: "127.0.0.1",
          funnel: false,
          applicationCredentialReference: "env:STACK_TOKEN",
          deviceApprovalVerified: true,
          leastPrivilegeVerified: true,
          strongIdentityVerified: true,
        },
      },
    }),
  );
  const unverified = await doctor({ ...options, configurationFile });
  assert.equal(unverified.ok, false);
  assert.equal(
    unverified.diagnostics.find((entry) => entry.id === "remote")!.status,
    "fail",
  );
  assert.equal(
    new Set(unverified.diagnostics.map((entry) => entry.id)).size,
    unverified.diagnostics.length,
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
