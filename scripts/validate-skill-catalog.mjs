import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseSkillName } from "./skill-frontmatter.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const root = resolve(dirname(scriptPath), "..");

const modePlaybooks = new Map([
  ["feature", "Mutating"],
  ["bug-fix", "Mutating"],
  ["refactor", "Mutating"],
  ["migration", "Mutating"],
  ["investigation", "Read-only"],
  ["review", "Read-only"],
  ["release", "Mutating"],
  ["orchestration", "Mutating"],
]);

const temporarySpecSkillPath = "skills/dev/spec/SKILL.md";

/** @typedef {{ name: string, path: string }} Skill */
/** @typedef {{ name: string, paths: string[] }} DuplicateSkill */

/**
 * @param {string} directory
 * @returns {Promise<string[]>}
 */
async function findSkillFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await findSkillFiles(path)));
    if (entry.isFile() && entry.name === "SKILL.md") files.push(path);
  }
  return files;
}

/**
 * @param {string} repositoryRoot
 * @returns {Promise<Skill[]>}
 */
export async function collectSkills(repositoryRoot) {
  const skillsRoot = resolve(repositoryRoot, "skills");
  const files = await findSkillFiles(skillsRoot);
  return Promise.all(
    files.map(async (path) => ({
      name: parseSkillName(await readFile(path, "utf8"), path),
      path: relative(repositoryRoot, path),
    })),
  );
}

/**
 * @param {Skill[][]} catalogs
 * @returns {DuplicateSkill[]}
 */
export function duplicateSkills(...catalogs) {
  const owners = new Map();
  for (const catalog of catalogs) {
    for (const skill of catalog) {
      const matches = owners.get(skill.name) ?? [];
      matches.push(skill.path);
      owners.set(skill.name, matches);
    }
  }
  return [...owners]
    .filter(([, paths]) => paths.length > 1)
    .map(([name, paths]) => ({ name, paths }));
}

/**
 * @param {string} left
 * @param {string} right
 * @returns {Promise<boolean>}
 */
async function directoriesMatch(left, right) {
  const [leftEntries, rightEntries] = await Promise.all([
    readdir(left, { withFileTypes: true }),
    readdir(right, { withFileTypes: true }),
  ]);
  /** @param {import("node:fs").Dirent} entry */
  const entryKey = (entry) =>
    `${entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other"}:${entry.name}`;
  const leftKeys = leftEntries.map(entryKey).sort();
  const rightKeys = rightEntries.map(entryKey).sort();
  if (JSON.stringify(leftKeys) !== JSON.stringify(rightKeys)) return false;

  for (const entry of leftEntries) {
    if (!entry.isDirectory() && !entry.isFile()) return false;
    const leftPath = resolve(left, entry.name);
    const rightPath = resolve(right, entry.name);
    if (entry.isDirectory()) {
      if (!(await directoriesMatch(leftPath, rightPath))) return false;
    } else {
      const [leftContents, rightContents] = await Promise.all([
        readFile(leftPath),
        readFile(rightPath),
      ]);
      if (!leftContents.equals(rightContents)) return false;
    }
  }
  return true;
}

/**
 * T9's approved, unreleased ownership exception applies only to an exact copy
 * of the pinned spec skill while this package cannot be published.
 *
 * @param {{ duplicates: DuplicateSkill[], stackRoot: string, generalRoot: string, packagePrivate: boolean }} input
 * @returns {Promise<Set<string>>}
 */
export async function approvedTemporaryDuplicateNames(input) {
  if (!input.packagePrivate) return new Set();

  const specDuplicate = input.duplicates.find(
    ({ name, paths }) =>
      name === "spec" &&
      paths.length === 2 &&
      paths.every((path) => path === temporarySpecSkillPath),
  );
  if (!specDuplicate) return new Set();

  const relativeSpecRoot = "skills/dev/spec";
  const matches = await directoriesMatch(
    resolve(input.stackRoot, relativeSpecRoot),
    resolve(input.generalRoot, relativeSpecRoot),
  );
  return matches ? new Set([specDuplicate.name]) : new Set();
}

/** @param {string} destination */
function decodedDestination(destination) {
  try {
    return decodeURIComponent(destination);
  } catch {
    return destination;
  }
}

/** @param {string} repositoryRoot */
export async function validateModePlaybooks(repositoryRoot) {
  const modeRoot = resolve(repositoryRoot, "skills/dev/kriscard-mode");
  const router = await readFile(resolve(modeRoot, "SKILL.md"), "utf8");
  const destinations = [...router.matchAll(/\]\(([^)\r\n]+)\)/g)]
    .map(([, destination]) => destination.trim())
    .filter((destination) =>
      decodedDestination(destination).toLowerCase().includes("playbooks"),
    );
  const invalidDestinations = destinations.filter((destination) => {
    const match = destination.match(/^playbooks\/([a-z-]+)\.md$/);
    return !match || !modePlaybooks.has(match[1]);
  });
  if (invalidDestinations.length > 0) {
    throw new Error(
      `Invalid mode playbook destinations: ${invalidDestinations.join(", ")}`,
    );
  }

  const links = destinations.map((destination) =>
    destination.slice("playbooks/".length, -".md".length),
  );
  const duplicateLinks = links.filter(
    (name, index) => links.indexOf(name) !== index,
  );
  if (duplicateLinks.length > 0) {
    throw new Error(
      `Duplicate mode playbook links: ${[...new Set(duplicateLinks)].join(", ")}`,
    );
  }

  const expectedNames = [...modePlaybooks.keys()].sort();
  const linkedNames = [...links].sort();
  const playbooksRoot = resolve(modeRoot, "playbooks");
  const fileNames = (await readdir(playbooksRoot))
    .filter((name) => name.endsWith(".md"))
    .map((name) => name.slice(0, -3))
    .sort();
  if (
    JSON.stringify(linkedNames) !== JSON.stringify(expectedNames) ||
    JSON.stringify(fileNames) !== JSON.stringify(expectedNames)
  ) {
    throw new Error(
      `Mode playbook routes and files must match: expected ${expectedNames.join(", ")}; linked ${linkedNames.join(", ")}; files ${fileNames.join(", ")}`,
    );
  }

  for (const [name, expectedClass] of modePlaybooks) {
    const contents = await readFile(
      resolve(playbooksRoot, `${name}.md`),
      "utf8",
    );
    const readWhen = contents
      .match(/^> \*\*Read this when:\*\*[ \t]*([^\r\n]*)$/m)?.[1]
      .trim();
    if (!readWhen) throw new Error(`${name}.md requires read-when guidance`);

    const sideEffectClass = contents.match(
      /^> \*\*Side-effect class:\*\*\s*(Read-only|Mutating)\.?$/m,
    )?.[1];
    if (sideEffectClass !== expectedClass) {
      throw new Error(`${name}.md must be ${expectedClass}`);
    }
  }
}

async function main() {
  const [manifest, packageManifest] = await Promise.all([
    readFile(resolve(root, "config/skills-source.json"), "utf8").then(
      JSON.parse,
    ),
    readFile(resolve(root, "package.json"), "utf8").then(JSON.parse),
  ]);
  const generalRoot = resolve(
    process.env.KRISCARD_SKILLS_REPO ?? resolve(root, "../Skills"),
  );
  const generalRevision = execFileSync(
    "git",
    ["-C", generalRoot, "rev-parse", "HEAD"],
    { encoding: "utf8" },
  ).trim();

  if (generalRevision !== manifest.revision) {
    throw new Error(
      `Skills checkout is ${generalRevision}; expected ${manifest.revision}`,
    );
  }

  await validateModePlaybooks(root);

  const stackSkills = await collectSkills(root);
  const generalSkills = await collectSkills(generalRoot);
  const duplicates = duplicateSkills(stackSkills, generalSkills);
  const approvedTemporaryDuplicates = await approvedTemporaryDuplicateNames({
    duplicates,
    stackRoot: root,
    generalRoot,
    packagePrivate: packageManifest.private === true,
  });
  const unapprovedDuplicates = duplicates.filter(
    ({ name }) => !approvedTemporaryDuplicates.has(name),
  );

  console.log(`Stack skills (${stackSkills.length}):`);
  console.log(
    stackSkills.map(({ name }) => `- ${name}`).join("\n") || "- none",
  );
  console.log(`General skills (${generalSkills.length}):`);
  console.log(
    generalSkills.map(({ name }) => `- ${name}`).join("\n") || "- none",
  );

  if (unapprovedDuplicates.length > 0) {
    const details = unapprovedDuplicates
      .map(({ name, paths }) => `${name}: ${paths.join(", ")}`)
      .join("\n");
    throw new Error(`Duplicate skill names found:\n${details}`);
  }

  if (approvedTemporaryDuplicates.size > 0) {
    console.log(
      `Approved temporary unreleased duplicate: ${[...approvedTemporaryDuplicates].join(", ")}`,
    );
  }
  console.log(
    `Catalogs validated (${stackSkills.length + generalSkills.length - duplicates.length} unique skill names)`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  await main();
}
