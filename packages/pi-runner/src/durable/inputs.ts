import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";

export type RoleProfileInput = {
  role: string;
  cwd: string;
  writePaths: readonly string[];
  checkIds: readonly string[];
  contextLimitBytes: number;
};

type ProfileBounds = {
  readonly cwd: string;
  readonly contextLimitBytes: number;
};

export type RoleProfile = ProfileBounds &
  (
    | {
        readonly role: "main" | "reviewer";
        readonly writePaths: readonly [];
        readonly checkIds: readonly [];
      }
    | {
        readonly role: "writer";
        readonly writePaths: readonly string[];
        readonly checkIds: readonly string[];
      }
    | {
        readonly role: "verifier";
        readonly writePaths: readonly [];
        readonly checkIds: readonly string[];
      }
  );

export type ContextSource = {
  readonly path: string;
  readonly sha256: string;
  readonly content: string;
};

export function requireTaskId(value: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) {
    throw new Error("resume requires a task ID, not a path");
  }

  return value;
}

const noEntries = Object.freeze<[]>([]);

export function requireWriteScope(paths: readonly string[]) {
  if (!paths.length) throw new Error("Writer requires an explicit write scope");

  for (const path of paths) {
    if (
      !path.trim() ||
      isAbsolute(path) ||
      path.split(/[\\/]/).some((part) => part === ".." || part === ".git")
    ) {
      throw new Error("Write scope must remain relative to the worktree and exclude Git metadata");
    }
  }
}

function requireContextLimit(limit: number) {
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error("Context limit must be a positive safe integer number of bytes");
  }
}

// These validate admission data; the task host must still enforce actual filesystem/tool authority.
export function createRoleProfile(input: RoleProfileInput): RoleProfile {
  requireContextLimit(input.contextLimitBytes);

  if (!isAbsolute(input.cwd)) throw new Error("Role cwd must be absolute");

  const bounds = { cwd: input.cwd, contextLimitBytes: input.contextLimitBytes };
  const checks = new Set<string>();

  for (const id of input.checkIds) {
    if (!/^[a-z][a-z0-9_-]*$/.test(id) || checks.has(id)) {
      throw new Error("Check IDs must be unique named profile entries");
    }

    checks.add(id);
  }

  if (input.role === "main" || input.role === "reviewer") {
    if (input.writePaths.length || input.checkIds.length) {
      throw new Error(`${input.role} cannot receive source writes or check execution`);
    }

    return Object.freeze({
      ...bounds,
      role: input.role,
      writePaths: noEntries,
      checkIds: noEntries,
    });
  }

  if (input.role === "verifier") {
    if (input.writePaths.length || !input.checkIds.length) {
      throw new Error("Verifier requires named checks and cannot receive direct source writes");
    }

    return Object.freeze({
      ...bounds,
      role: "verifier",
      writePaths: noEntries,
      checkIds: Object.freeze([...input.checkIds]),
    });
  }

  if (input.role !== "writer") throw new Error("Unknown agent role");

  requireWriteScope(input.writePaths);

  return Object.freeze({
    ...bounds,
    role: "writer",
    writePaths: Object.freeze([...input.writePaths]),
    checkIds: Object.freeze([...input.checkIds]),
  });
}

export function createContextPacket(sources: readonly ContextSource[], contextLimitBytes: number) {
  requireContextLimit(contextLimitBytes);
  const paths = new Set<string>();

  for (const source of sources) {
    if (!isAbsolute(source.path) || paths.has(source.path)) {
      throw new Error("Context sources require unique absolute paths");
    }

    const hash = createHash("sha256").update(source.content, "utf8").digest("hex");

    if (hash !== source.sha256) throw new Error("Context content does not match its pinned hash");
    paths.add(source.path);
  }

  const bytes = Buffer.byteLength(JSON.stringify(sources), "utf8");

  if (bytes > contextLimitBytes) throw new Error("Context packet exceeds its admitted byte limit");

  return Object.freeze({
    sources: Object.freeze(sources.map((source) => Object.freeze({ ...source }))),
    bytes,
    contextLimitBytes,
  });
}
