import { createHash } from "node:crypto";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

export type SkillEntry = { name: string; sha256: string };

/** Inspect source and installed skills without following directory cycles. */
export async function catalog(root: string): Promise<SkillEntry[]> {
  const visited = new Set<string>();
  const skills: SkillEntry[] = [];
  let inspected = 0;
  async function visit(directory: string): Promise<void> {
    const canonical = await realpath(directory);
    if (visited.has(canonical)) return;
    visited.add(canonical);
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      if (++inspected > 10_000) throw new Error("Skill catalog is too large");
      const location = path.join(directory, entry.name);
      const info = await stat(location);
      if (info.isDirectory()) await visit(location);
      else if (info.isFile() && entry.name === "SKILL.md") {
        if (info.size > 1024 * 1024) throw new Error("Skill file is too large");
        const bytes = await readFile(location);
        const frontmatter = bytes
          .toString("utf8")
          .match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
        const raw = frontmatter
          ?.split(/\r?\n/)
          .find((line) => line.startsWith("name:"))
          ?.slice(5)
          .trim();
        const name = raw?.replace(/^(?:"([^"]+)"|'([^']+)')$/, "$1$2");
        if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name))
          throw new Error("Invalid skill frontmatter");
        skills.push({
          name,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        });
      }
    }
  }
  await visit(root);
  return skills;
}
