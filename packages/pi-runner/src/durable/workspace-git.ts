import { createHash } from "node:crypto";
import { lstat, readFile, readlink, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";

import { executeGit, gitExecutionControl, type GitExecutionControl } from "./git-execution.js";

async function optionalLstat(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
    throw error;
  }
}

export async function canonicalTarget(path: string) {
  if (!isAbsolute(path) || join(await realpath(dirname(path)), basename(path)) !== path) {
    throw new Error("Worktree target must be an absolute canonical path with an existing parent");
  }

  const info = await optionalLstat(path);

  if (info && (!info.isDirectory() || (await realpath(path)) !== path)) {
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

export async function inspectGit(
  worktree: string,
  control: GitExecutionControl = gitExecutionControl(),
): Promise<GitBinding> {
  control = { deadline: control.deadline, signal: control.signal };

  const git = (directory: string, argv: readonly string[]) =>
    executeGit({ cwd: directory, argv, ...control });

  control.signal.throwIfAborted();
  await canonicalTarget(worktree);

  if ((await git(worktree, ["rev-parse", "--show-toplevel"])).trim() !== worktree) {
    throw new Error("Expected the exact canonical Git worktree root");
  }

  const commonDirectory = await realpath(
    (await git(worktree, ["rev-parse", "--path-format=absolute", "--git-common-dir"])).trim(),
  );

  const treeInfo = await stat(worktree, { bigint: true });
  const commonInfo = await stat(commonDirectory, { bigint: true });
  const head = (await git(worktree, ["rev-parse", "--verify", "HEAD^{commit}"])).trim();
  const branch = (await git(worktree, ["symbolic-ref", "--short", "HEAD"])).trim();
  const digest = createHash("sha256").update("kstack-source-v2\0");

  const names = await git(worktree, [
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
  ]);

  digest.update(
    JSON.stringify([
      head,
      branch,
      await git(worktree, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
      await git(worktree, ["ls-files", "--stage", "-z"]),
    ]),
  );

  for (const name of [...new Set(names.split("\0").filter(Boolean))].sort()) {
    control.signal.throwIfAborted();

    if (Date.now() >= control.deadline) throw new Error("Git fingerprint deadline expired");
    const path = join(worktree, name);
    const info = await optionalLstat(path);

    if (!info) {
      digest.update(JSON.stringify([name, null, "missing", null]));
      continue;
    }

    if ((await realpath(dirname(path))) !== dirname(path))
      throw new Error("Material source crosses a directory symbolic link");

    const content = info.isSymbolicLink()
      ? await readlink(path)
      : info.isFile()
        ? await readFile(path, { signal: control.signal })
        : undefined;

    if (content === undefined)
      throw new Error("Nested repositories/submodules require separate admission");
    digest.update(
      JSON.stringify([
        name,
        info.mode,
        info.isSymbolicLink() ? "symlink" : "file",
        createHash("sha256").update(content).digest("hex"),
      ]),
    );
  }

  control.signal.throwIfAborted();

  if (Date.now() >= control.deadline) throw new Error("Git fingerprint deadline expired");

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

export async function requireSameGit(
  expected: GitBinding,
  actual?: GitBinding,
  control: GitExecutionControl = gitExecutionControl(),
) {
  const observed = actual ?? (await inspectGit(expected.worktree, control));

  if (JSON.stringify(expected) !== JSON.stringify(observed)) {
    throw new Error(
      "Worktree Git identity or material source binding changed; reconciliation required",
    );
  }
}

// Release-only recovery may ignore source drift, never a moved/replaced root,
// common directory, branch or HEAD. This does not authorize source rebinding.
export function requireSameGitIdentity(expected: GitBinding, actual: GitBinding) {
  if (
    expected.worktree !== actual.worktree ||
    expected.device !== actual.device ||
    expected.inode !== actual.inode ||
    expected.commonDirectory !== actual.commonDirectory ||
    expected.commonDevice !== actual.commonDevice ||
    expected.commonInode !== actual.commonInode ||
    expected.branch !== actual.branch ||
    expected.head !== actual.head
  )
    throw new Error("Worktree Git identity changed; reconciliation required");
}
