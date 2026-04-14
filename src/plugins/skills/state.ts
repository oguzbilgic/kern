import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { log } from "../../log.js";

const STATE_FILE = "active-skills.json";

/** In-memory set of active skill names */
let activeSkills = new Set<string>();

/** Path to persistence file */
let statePath = "";

export function initState(agentDir: string) {
  statePath = join(agentDir, ".kern", STATE_FILE);
}

export async function loadActiveSkills(): Promise<Set<string>> {
  if (!statePath || !existsSync(statePath)) return activeSkills;

  try {
    const raw = await readFile(statePath, "utf-8");
    const names: string[] = JSON.parse(raw);
    activeSkills = new Set(names);
    if (activeSkills.size > 0) {
      log("skills", `restored ${activeSkills.size} active skill(s)`);
    }
  } catch (err: any) {
    log.warn("skills", `failed to load active skills: ${err.message}`);
  }
  return activeSkills;
}

async function persist() {
  if (!statePath) return;
  try {
    const dir = join(statePath, "..");
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    await writeFile(statePath, JSON.stringify([...activeSkills], null, 2));
  } catch (err: any) {
    log.warn("skills", `failed to persist active skills: ${err.message}`);
  }
}

export function getActiveSkills(): Set<string> {
  return activeSkills;
}

export function isActive(name: string): boolean {
  return activeSkills.has(name);
}

/** Activate a skill. Returns true if newly activated, false if already active. */
export async function activate(name: string): Promise<boolean> {
  if (activeSkills.has(name)) return false;
  activeSkills.add(name);
  await persist();
  return true;
}

/** Deactivate a skill. Returns true if was active, false if wasn't. */
export async function deactivate(name: string): Promise<boolean> {
  if (!activeSkills.has(name)) return false;
  activeSkills.delete(name);
  await persist();
  return true;
}
