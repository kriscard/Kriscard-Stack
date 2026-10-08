import { constants, existsSync, realpathSync } from "node:fs";
import { chmod, lstat, mkdir, open, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { artifactStoreError } from "./errors.js";

const privateDirectoryMode = 0o700;
export const privateFileMode = 0o600;

export function defaultArtifactRoot(
  environment: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  const dataHome = environment.XDG_DATA_HOME?.trim();
  if (dataHome && !path.isAbsolute(dataHome)) {
    throw artifactStoreError(
      "INVALID_PATH",
      "XDG_DATA_HOME must be an absolute path",
    );
  }
  return path.resolve(
    dataHome || path.join(home, ".local", "share"),
    "kriscard-stack",
  );
}

export function canonicalizePotentialPath(inputPath: string): string {
  const missingSegments: string[] = [];
  let current = path.resolve(inputPath);
  while (!existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    missingSegments.push(path.basename(current));
    current = parent;
  }
  const canonicalAncestor = realpathSync.native(current);
  return path.join(canonicalAncestor, ...missingSegments.reverse());
}

export function assertSafeRelativePath(relativePath: string): string {
  if (
    relativePath.length === 0 ||
    relativePath.startsWith("/") ||
    /^[A-Za-z]:/.test(relativePath) ||
    relativePath.includes("\\") ||
    relativePath.includes("\0")
  ) {
    throw artifactStoreError(
      "INVALID_PATH",
      `Artifact path must be a non-empty portable relative path: ${relativePath}`,
    );
  }

  const segments = relativePath.split("/");
  if (
    segments.some((segment) => {
      const baseName = segment.split(".")[0]?.toUpperCase() ?? "";
      return (
        segment === "" ||
        segment === "." ||
        segment === ".." ||
        !/^[A-Za-z0-9._-]+$/.test(segment) ||
        /[. ]$/.test(segment) ||
        /^\..+\.kriscard-tmp$/i.test(segment) ||
        /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(baseName)
      );
    })
  ) {
    throw artifactStoreError(
      "INVALID_PATH",
      `Artifact path contains an unsafe segment: ${relativePath}`,
    );
  }
  return segments.join("/");
}

export function portablePathKey(relativePath: string): string {
  return assertSafeRelativePath(relativePath).normalize("NFKC").toLowerCase();
}

export function resolveWithin(root: string, relativePath: string): string {
  const safeRelative = assertSafeRelativePath(relativePath);
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...safeRelative.split("/"));
  if (
    resolved !== resolvedRoot &&
    !resolved.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw artifactStoreError(
      "INVALID_PATH",
      `Artifact path escapes its root: ${relativePath}`,
    );
  }
  return resolved;
}

async function inspectDirectory(
  directory: string,
  created = false,
): Promise<void> {
  const info = await lstat(directory);
  if (info.isSymbolicLink()) {
    throw artifactStoreError(
      "SYMLINK_ESCAPE",
      `Refusing symbolic-link directory: ${directory}`,
    );
  }
  if (!info.isDirectory()) {
    throw artifactStoreError(
      "INVALID_PATH",
      `Expected directory: ${directory}`,
    );
  }
  if (created) {
    await chmod(directory, privateDirectoryMode);
    await syncDirectoryEntry(directory);
  } else if ((info.mode & 0o777) !== privateDirectoryMode) {
    throw artifactStoreError(
      "INVALID_PATH",
      `Existing artifact directory must already be private: ${directory}`,
    );
  }
}

export async function ensurePrivateDirectory(
  root: string,
  relativePath?: string,
): Promise<string> {
  const resolvedRoot = path.resolve(root);
  await createPrivateRoot(resolvedRoot);

  if (!relativePath) return resolvedRoot;
  const safeRelative = assertSafeRelativePath(relativePath);
  let current = resolvedRoot;
  for (const segment of safeRelative.split("/")) {
    current = path.join(current, segment);
    let created = false;
    try {
      await mkdir(current, { mode: privateDirectoryMode });
      created = true;
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
    await inspectDirectory(current, created);
    if (created) await syncDirectoryEntry(path.dirname(current));
  }
  return current;
}

export async function assertSafeSourceFile(
  sourceRoot: string,
  relativePath: string,
): Promise<string> {
  const resolvedRoot = path.resolve(sourceRoot);
  await inspectDirectoryWithoutChangingMode(resolvedRoot);
  if ((await realpath(resolvedRoot)) !== resolvedRoot) {
    throw artifactStoreError(
      "SYMLINK_ESCAPE",
      `Source root changed or is not canonical: ${resolvedRoot}`,
    );
  }
  const safeRelative = assertSafeRelativePath(relativePath);
  let current = resolvedRoot;
  const segments = safeRelative.split("/");

  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    const info = await lstat(current);
    if (info.isSymbolicLink()) {
      throw artifactStoreError(
        "SYMLINK_ESCAPE",
        `Refusing symbolic-link artifact source: ${current}`,
      );
    }
    const isLast = index === segments.length - 1;
    if (isLast ? !info.isFile() : !info.isDirectory()) {
      throw artifactStoreError(
        "INVALID_PATH",
        `Unexpected artifact source type: ${current}`,
      );
    }
  }
  return current;
}

export async function readFileWithoutFollowingSymlinks(
  filePath: string,
): Promise<Buffer> {
  const handle = await open(
    filePath,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

async function createPrivateRoot(resolvedRoot: string): Promise<void> {
  const missing: string[] = [];
  let current = resolvedRoot;
  while (true) {
    try {
      await inspectDirectoryWithoutChangingMode(current);
      break;
    } catch (error) {
      if (!isMissing(error)) throw error;
      missing.push(current);
      const parent = path.dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }

  for (const directory of missing.reverse()) {
    let created = false;
    try {
      await mkdir(directory, { mode: privateDirectoryMode });
      created = true;
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
    }
    await inspectDirectory(directory, created);
    if (created) await syncDirectoryEntry(path.dirname(directory));
  }
  await inspectDirectory(resolvedRoot);
}

async function inspectDirectoryWithoutChangingMode(
  directory: string,
): Promise<void> {
  const info = await lstat(directory);
  if (info.isSymbolicLink()) {
    throw artifactStoreError(
      "SYMLINK_ESCAPE",
      `Refusing symbolic-link directory: ${directory}`,
    );
  }
  if (!info.isDirectory()) {
    throw artifactStoreError(
      "INVALID_PATH",
      `Expected directory: ${directory}`,
    );
  }
}

async function syncDirectoryEntry(directory: string): Promise<void> {
  const handle = await open(directory, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
