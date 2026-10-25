import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readlinkSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";

export function git(directory: string, args: readonly string[]) {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
  );

  return execFileSync(
    "git",
    [
      "--no-optional-locks",
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "core.fsmonitor=false",
      ...args,
    ],
    {
      cwd: directory,
      env: {
        ...environment,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0",
      },
      encoding: "utf8",
      timeout: 120_000,
      killSignal: "SIGKILL",
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
}

export function canonicalTarget(path: string) {
  if (!isAbsolute(path) || join(realpathSync(dirname(path)), basename(path)) !== path) {
    throw new Error("Worktree target must be an absolute canonical path with an existing parent");
  }

  const info = lstatSync(path, { throwIfNoEntry: false });

  if (info && (!info.isDirectory() || realpathSync(path) !== path)) {
    throw new Error("Worktree target must be a real directory, not a link");
  }

  return path;
}

export type GitBinding = {
  worktree: string;
  device: string;
  inode: string;
  commonDirectory: string;
  commonDevice: string;
  commonInode: string;
  branch: string;
  head: string;
  sourceHash: string;
};

export function inspectGit(worktree: string): GitBinding {
  canonicalTarget(worktree);

  if (git(worktree, ["rev-parse", "--show-toplevel"]).trim() !== worktree) {
    throw new Error("Expected the exact canonical Git worktree root");
  }

  const commonDirectory = realpathSync(
    git(worktree, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim(),
  );

  const treeInfo = statSync(worktree, { bigint: true });
  const commonInfo = statSync(commonDirectory, { bigint: true });
  const head = git(worktree, ["rev-parse", "--verify", "HEAD^{commit}"]).trim();
  const branch = git(worktree, ["symbolic-ref", "--short", "HEAD"]).trim();
  const digest = createHash("sha256");
  const names = git(worktree, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  digest.update(
    JSON.stringify([
      head,
      branch,
      git(worktree, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
      git(worktree, ["ls-files", "--stage", "-z"]),
    ]),
  );

  for (const name of [...new Set(names.split("\0").filter(Boolean))].sort()) {
    const path = join(worktree, name);
    const info = lstatSync(path, { throwIfNoEntry: false });
    digest.update(JSON.stringify([name, info?.mode ?? null]));

    if (!info) continue;

    if (realpathSync(dirname(path)) !== dirname(path))
      throw new Error("Material source crosses a directory symbolic link");

    if (info.isSymbolicLink()) digest.update(readlinkSync(path));
    else if (info.isFile()) digest.update(readFileSync(path));
    else throw new Error("Nested repositories/submodules require separate admission");
  }

  return {
    worktree,
    device: treeInfo.dev.toString(),
    inode: treeInfo.ino.toString(),
    commonDirectory,
    commonDevice: commonInfo.dev.toString(),
    commonInode: commonInfo.ino.toString(),
    branch,
    head,
    sourceHash: digest.digest("hex"),
  };
}

export function requireSameGit(expected: GitBinding, actual = inspectGit(expected.worktree)) {
  if (JSON.stringify(expected) !== JSON.stringify(actual)) {
    throw new Error(
      "Worktree Git identity or material source binding changed; reconciliation required",
    );
  }
}
