import { readdir, readFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { log } from "../../log.js";

export interface SkillInfo {
  /** Skill name (from frontmatter or folder name) */
  name: string;
  /** Short description from frontmatter */
  description: string;
  /** Absolute path to skill directory */
  path: string;
  /** Where it came from */
  source: "local" | "installed";
  /** Full SKILL.md body (below frontmatter) */
  body: string;
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
async function scanDir(dir: string, source: "local" | "installed"): Promise<SkillInfo[]> {
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
 * Scan both skill directories and return merged catalog.
 */
export async function scanSkills(agentDir: string): Promise<SkillInfo[]> {
  const local = await scanDir(join(agentDir, "skills"), "local");
  const installed = await scanDir(join(agentDir, ".agents", "skills"), "installed");
  return [...local, ...installed];
}
