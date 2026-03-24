import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { homedir } from "os";

export interface AgentEntry {
  name: string;
  path: string;
  addedAt: string;
}

const KERN_DIR = join(homedir(), ".kern");
const AGENTS_FILE = join(KERN_DIR, "agents.json");

async function ensureDir(): Promise<void> {
  await mkdir(KERN_DIR, { recursive: true });
}

export async function loadRegistry(): Promise<AgentEntry[]> {
  if (!existsSync(AGENTS_FILE)) return [];
  try {
    const raw = await readFile(AGENTS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveRegistry(agents: AgentEntry[]): Promise<void> {
  await ensureDir();
  await writeFile(AGENTS_FILE, JSON.stringify(agents, null, 2) + "\n", "utf-8");
}

export async function registerAgent(name: string, path: string): Promise<void> {
  const agents = await loadRegistry();
  const existing = agents.findIndex((a) => a.path === path);
  if (existing >= 0) {
    // Update name if changed
    agents[existing].name = name;
  } else {
    agents.push({
      name,
      path,
      addedAt: new Date().toISOString(),
    });
  }
  await saveRegistry(agents);
}
