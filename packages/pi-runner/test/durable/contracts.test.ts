import { expect, expectTypeOf, test } from "vitest";

import { parseDurableInvocation } from "../../src/durable/commands.js";
import {
  createContextPacket,
  createRoleProfile,
  type RoleProfile,
} from "../../src/durable/inputs.js";

const source = {
  path: "/repo/AGENTS.md",
  content: "hello",
  sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
};

test("leaves existing native and setup commands to the existing CLI", () => {
  for (const args of [[], ["run", "request"], ["setup"], ["--continue"], ["durable-looking"]]) {
    expect(parseDurableInvocation(args)).toBeUndefined();
  }
});

test("the native escape preserves all following arguments without interpreting SDK words", () => {
  expect(parseDurableInvocation(["--", "durable", "start", "--help"])).toEqual({
    type: "native-escape",
    arguments: ["durable", "start", "--help"],
  });
});

test("parses start with exact prompt text and configured input references", () => {
  expect(
    parseDurableInvocation([
      "durable",
      "start",
      "  Build two features  ",
      "--model",
      "configured/model:high",
      "--state-dir=/private/task-state",
    ]),
  ).toEqual({
    type: "durable-start",
    request: "  Build two features  ",
    model: "configured/model:high",
    stateDir: "/private/task-state",
  });
});

test("a positional separator keeps help-looking request text literal", () => {
  expect(parseDurableInvocation(["durable", "start", "--", "--help"])).toEqual({
    type: "durable-start",
    request: "--help",
    model: undefined,
    stateDir: undefined,
  });
  expect(parseDurableInvocation(["durable", "--help"])).toEqual({ type: "help" });
  expect(parseDurableInvocation(["durable", "start", "-h"])).toEqual({ type: "help" });
});

test("resume keeps its recorded model rather than accepting a replacement", () => {
  expect(parseDurableInvocation(["durable", "resume", "task-01", "--state-dir", "/state"])).toEqual(
    {
      type: "durable-resume",
      taskId: "task-01",
      stateDir: "/state",
    },
  );
  expect(() =>
    parseDurableInvocation(["durable", "resume", "task-01", "--model", "other/model"]),
  ).toThrow("--model is not supported for resume");
});

test("administrative release names an absolute worktree without admitting model flags", () => {
  expect(
    parseDurableInvocation(["durable", "release-worktree", "/repo-worktrees/feature"]),
  ).toEqual({
    type: "durable-release-worktree",
    worktree: "/repo-worktrees/feature",
  });
  expect(() =>
    parseDurableInvocation([
      "durable",
      "release-worktree",
      "/repo-worktrees/feature",
      "--state-dir",
      "/state",
    ]),
  ).toThrow("does not accept --state-dir");
});

test.each([
  ["durable"],
  ["durable", "unknown"],
  ["durable", "start"],
  ["durable", "start", "  "],
  ["durable", "start", "first", "second"],
  ["durable", "start", "request", "--state-dir", "relative"],
  ["durable", "start", "request", "--model", ""],
  ["durable", "start", "request", "--shell", "bash"],
  ["durable", "start", "request", "--model", "one", "--model", "two"],
  ["durable", "resume", "../other-task"],
  ["durable", "resume", "/other-task"],
  ["durable", "release-worktree", "relative"],
])("rejects malformed or authority-widening inputs: %j", (...args) => {
  expect(() => parseDurableInvocation(args)).toThrow();
});

test.each(["main", "reviewer"])("%s profiles cannot acquire writes or checks", (role) => {
  const input = { role, cwd: "/repo", writePaths: [], checkIds: [], contextLimitBytes: 4096 };
  expect(createRoleProfile(input)).toMatchObject({ role, writePaths: [], checkIds: [] });
  expect(() => createRoleProfile({ ...input, writePaths: ["src/**"] })).toThrow("cannot receive");
  expect(() => createRoleProfile({ ...input, checkIds: ["test"] })).toThrow("cannot receive");
});

test("the role model excludes source-writing scope from read-only and verifier profiles", () => {
  expectTypeOf<Extract<RoleProfile, { role: "main" | "reviewer" }>["writePaths"]>().toEqualTypeOf<
    readonly []
  >();
  expectTypeOf<Extract<RoleProfile, { role: "verifier" }>["writePaths"]>().toEqualTypeOf<
    readonly []
  >();
});

test("verifiers require named checks but never direct source-writing capability", () => {
  const input = {
    role: "verifier",
    cwd: "/verification-snapshot",
    writePaths: [],
    checkIds: ["check"],
    contextLimitBytes: 4096,
  };

  expect(createRoleProfile(input)).toMatchObject({ role: "verifier", checkIds: ["check"] });
  expect(() => createRoleProfile({ ...input, checkIds: [] })).toThrow("requires named checks");
  expect(() => createRoleProfile({ ...input, writePaths: ["src/**"] })).toThrow("cannot receive");
});

test("writer profiles retain a copy of their admitted scope", () => {
  const writePaths = ["src/feature/**"];
  const checkIds = ["test"];

  const profile = createRoleProfile({
    role: "writer",
    cwd: "/repo-worktrees/feature",
    writePaths,
    checkIds,
    contextLimitBytes: 4096,
  });

  writePaths.push("other-feature/**");
  checkIds.push("publish");
  expect(profile.writePaths).toEqual(["src/feature/**"]);
  expect(profile.checkIds).toEqual(["test"]);
});

test.each([[], ["../other/**"], ["/other/**"], [".git/config"]])(
  "rejects absent, escaping, or Git-metadata write scopes: %j",
  (...writePaths) => {
    expect(() =>
      createRoleProfile({
        role: "writer",
        cwd: "/repo",
        writePaths,
        checkIds: [],
        contextLimitBytes: 4096,
      }),
    ).toThrow();
  },
);

test("profiles reject unknown roles, duplicate checks, relative cwd, and unbounded context", () => {
  const input = {
    role: "verifier",
    cwd: "/repo",
    writePaths: [],
    checkIds: ["check"],
    contextLimitBytes: 4096,
  };

  expect(() => createRoleProfile({ ...input, role: "administrator" })).toThrow(
    "Unknown agent role",
  );
  expect(() => createRoleProfile({ ...input, checkIds: ["check", "check"] })).toThrow("unique");
  expect(() => createRoleProfile({ ...input, cwd: "relative" })).toThrow("absolute");
  expect(() => createRoleProfile({ ...input, contextLimitBytes: Infinity })).toThrow(
    "positive safe integer",
  );
});

test("context packets require pinned content and unique absolute sources within their limit", () => {
  const packet = createContextPacket([source], 4096);
  expect(packet.sources).toEqual([source]);
  expect(() => createContextPacket([{ ...source, content: "changed" }], 4096)).toThrow(
    "pinned hash",
  );
  expect(() => createContextPacket([source, source], 4096)).toThrow("unique absolute paths");
  expect(() => createContextPacket([{ ...source, path: "relative" }], 4096)).toThrow("absolute");
  expect(() => createContextPacket([source], 1)).toThrow("byte limit");
  expect(() => createContextPacket([source], 0)).toThrow("positive safe integer");
});
