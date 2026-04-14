import { readdir, readFile } from "fs/promises";
import { join, dirname } from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { log } from "../../log.js";

export type SkillSource = "local" | "installed" | "builtin";

export interface SkillInfo {
  /** Skill name (from frontmatter or folder name) */
  name: string;
  /** Short description from frontmatter */
  description: string;
  /** Absolute path to skill directory */
  path: string;
  /** Logical display path (e.g. skills/<name>/SKILL.md) */
  displayPath: string;
  /** Where it came from */
  source: SkillSource;
}

/** Resolve kern package root (where package.json lives) */
function getPackageRoot(): string {
  // This file is at <pkg>/dist/plugins/skills/scanner.js (built) or src/plugins/skills/scanner.ts
  const thisFile = fileURLToPath(import.meta.url);
  // Walk up to package root: dist/plugins/skills/ → dist/plugins/ → dist/ → pkg root
  return dirname(dirname(dirname(dirname(thisFile))));
}

/**
 * Parse YAML frontmatter from SKILL.md content.
 * Returns { meta, body } where meta has name/description extracted from simple key: value lines.
 */
function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  const meta: Record<string, string> = {};
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!match) return { meta, body: content };

  const yamlBlock = match[1];
  const body = match[2];

  for (const line of yamlBlock.split("\n")) {
    const kv = line.match(/^(\w[\w_-]*):\s*(.+)$/);
    if (kv) meta[kv[1].trim()] = kv[2].trim().replace(/^["']|["']$/g, "");
  }

  return { meta, body };
}

/** Derive logical display path from source and name */
function getDisplayPath(name: string, source: SkillSource): string {
  switch (source) {
    case "installed": return `.agents/skills/${name}/SKILL.md`;
    default: return `skills/${name}/SKILL.md`;
  }
}

/**
 * Scan a single skills directory for subdirectories containing SKILL.md.
 * Only reads frontmatter for catalog — full body loaded lazily on activation.
 */
async function scanDir(dir: string, source: SkillSource): Promise<SkillInfo[]> {
  if (!existsSync(dir)) return [];

  const skills: SkillInfo[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillDir = join(dir, entry.name);
    const skillFile = join(skillDir, "SKILL.md");
    if (!existsSync(skillFile)) continue;

    try {
      const content = await readFile(skillFile, "utf-8");
      const { meta } = parseFrontmatter(content);
      const name = meta.name || entry.name;

      skills.push({
        name,
        description: meta.description || "",
        path: skillDir,
        displayPath: getDisplayPath(name, source),
        source,
      });
    } catch (err: any) {
      log.warn("skills", `failed to read ${skillFile}: ${err.message}`);
    }
  }

  return skills;
}

/**
 * Load full SKILL.md body for a specific skill (below frontmatter).
 */
export async function loadSkillBody(skill: SkillInfo): Promise<string> {
  const skillFile = join(skill.path, "SKILL.md");
  const content = await readFile(skillFile, "utf-8");
  const { body } = parseFrontmatter(content);
  return body.trim() || content.trim();
}

/**
 * Scan all skill directories and return merged catalog.
 * Priority: local (agent) > installed (.agents) > builtin (kern package).
 * Same-name skills in higher priority shadow lower ones.
 */
export async function scanSkills(agentDir: string): Promise<SkillInfo[]> {
  const local = await scanDir(join(agentDir, "skills"), "local");
  const installed = await scanDir(join(agentDir, ".agents", "skills"), "installed");
  const builtin = await scanDir(join(getPackageRoot(), "skills"), "builtin");

  // Merge with dedup — first occurrence wins (highest priority first)
  const seen = new Set<string>();
  const merged: SkillInfo[] = [];
  for (const skill of [...local, ...installed, ...builtin]) {
    if (seen.has(skill.name)) continue;
    seen.add(skill.name);
    merged.push(skill);
  }
  return merged;
}
