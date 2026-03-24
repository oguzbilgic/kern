import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { homedir } from "os";

export interface AgentEntry {
  name: string;
  path: string;
  pid?: number | null;
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
    agents[existing].name = name;
  } else {
    agents.push({
      name,
      path,
      pid: null,
      addedAt: new Date().toISOString(),
    });
  }
  await saveRegistry(agents);
}

export async function findAgent(nameOrPath: string): Promise<AgentEntry | null> {
  const agents = await loadRegistry();
  return agents.find((a) => a.name === nameOrPath || a.path === nameOrPath) || null;
}

export async function setPid(nameOrPath: string, pid: number | null): Promise<void> {
  const agents = await loadRegistry();
  const agent = agents.find((a) => a.name === nameOrPath || a.path === nameOrPath);
  if (agent) {
    agent.pid = pid;
    await saveRegistry(agents);
  }
}

export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
