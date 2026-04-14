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
  /** Where it came from */
  source: SkillSource;
  /** Full SKILL.md body (below frontmatter) */
  body: string;
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

/**
 * Scan a single skills directory for subdirectories containing SKILL.md.
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
      const { meta, body } = parseFrontmatter(content);

      skills.push({
        name: meta.name || entry.name,
        description: meta.description || "",
        path: skillDir,
        source,
        body: body.trim() || content.trim(),
      });
    } catch (err: any) {
      log.warn("skills", `failed to read ${skillFile}: ${err.message}`);
    }
  }

  return skills;
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
