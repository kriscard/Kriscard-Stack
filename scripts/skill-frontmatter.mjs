/**
 * Parse the bounded YAML subset used by skill frontmatter. Inline plain and
 * quoted scalars plus folded or literal block scalars share one normalization
 * path so catalog consumers agree on skill names and descriptions.
 */

/**
 * @param {string} contents
 * @param {string} path
 */
export function skillFrontmatter(contents, path) {
  const match = contents.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!match) throw new Error(`${path} has no YAML frontmatter`);
  return match[1];
}

/**
 * @param {string} source
 * @param {string} key
 * @returns {string | undefined}
 */
export function frontmatterField(source, key) {
  const lines = source.split("\n");
  const index = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (index === -1) return undefined;

  const inline = lines[index].slice(key.length + 1).trim();
  if (inline && !/^[>|][+-]?$/.test(inline)) {
    return inline
      .replace(/^(?:"([^"]*)"|'([^']*)')$/, (_, double, single) =>
        String(double ?? single ?? ""),
      )
      .trim();
  }

  const continuation = [];
  for (const line of lines.slice(index + 1)) {
    if (line.length > 0 && !/^\s/.test(line)) break;
    if (line.trim()) continuation.push(line.trim());
  }

  return continuation.join(" ").trim() || undefined;
}

/**
 * @param {string} contents
 * @param {string} path
 */
export function parseSkillName(contents, path) {
  const name = frontmatterField(skillFrontmatter(contents, path), "name");
  if (!name) throw new Error(`${path} has no skill name`);
  return name;
}
