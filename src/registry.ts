import { readFile, writeFile, mkdir, unlink } from "fs/promises";
import { join, basename } from "path";
import { existsSync, readFileSync } from "fs";
import { homedir } from "os";
import { config as loadDotenv } from "dotenv";

/**
 * Registry is a simple list of agent directory paths.
 * All agent state (port, token, PID) lives in the agent's own .kern/ directory.
 */

export interface AgentInfo {
  name: string;
  path: string;
  port: number;
  token: string | null;
  pid: number | null;
}

const KERN_DIR = join(homedir(), ".kern");
const AGENTS_FILE = join(KERN_DIR, "agents.json");

async function ensureDir(): Promise<void> {
  await mkdir(KERN_DIR, { recursive: true });
}

// --- Registry: list of paths ---

export async function loadRegistry(): Promise<string[]> {
  if (!existsSync(AGENTS_FILE)) return [];
  try {
    const raw = await readFile(AGENTS_FILE, "utf-8");
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

async function saveRegistry(paths: string[]): Promise<void> {
  await ensureDir();
  await writeFile(AGENTS_FILE, JSON.stringify(paths, null, 2) + "\n", "utf-8");
}

export async function registerAgent(path: string): Promise<void> {
  const paths = await loadRegistry();
  if (!paths.includes(path)) {
    paths.push(path);
    await saveRegistry(paths);
  }
}

export async function removeAgent(nameOrPath: string): Promise<boolean> {
  const paths = await loadRegistry();
  // Try direct path match
  let idx = paths.indexOf(nameOrPath);
  // Try name match
  if (idx < 0) {
    for (let i = 0; i < paths.length; i++) {
      const info = readAgentInfo(paths[i]);
      if (info && info.name === nameOrPath) {
        idx = i;
        break;
      }
    }
  }
  if (idx < 0) return false;
  paths.splice(idx, 1);
  await saveRegistry(paths);
  return true;
}

// --- Agent info: read from agent's own .kern/ directory ---

export function readAgentInfo(agentPath: string): AgentInfo | null {
  if (!existsSync(agentPath)) return null;

  const configPath = join(agentPath, ".kern", "config.json");
  const envPath = join(agentPath, ".kern", ".env");
  const pidPath = join(agentPath, ".kern", "agent.pid");

  // Read config for name and port
  let name = basename(agentPath);
  let port = 0;
  try {
    const raw = readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw);
    if (config.name) name = config.name;
    if (config.port) port = config.port;
  } catch {}

  // Read token from .env
  let token: string | null = null;
  try {
    const env = loadDotenv({ path: envPath, override: false });
    token = env.parsed?.KERN_AUTH_TOKEN || null;
  } catch {}

  // Read PID
  let pid: number | null = null;
  try {
    const raw = readFileSync(pidPath, "utf-8").trim();
    pid = parseInt(raw, 10);
    if (isNaN(pid)) pid = null;
  } catch {}

  return { name, port, token, pid, path: agentPath };
}

export function findAgent(nameOrPath: string): AgentInfo | null {
  let paths: string[];
  try {
    if (!existsSync(AGENTS_FILE)) return null;
    const raw = readFileSync(AGENTS_FILE, "utf-8");
    paths = JSON.parse(raw) as string[];
  } catch {
    return null;
  }

  for (const p of paths) {
    const info = readAgentInfo(p);
    if (!info) continue;
    if (info.name === nameOrPath || info.path === nameOrPath || p === nameOrPath) {
      return info;
    }
  }
  return null;
}

export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// --- PID file management ---

export async function writePidFile(agentDir: string, pid: number): Promise<void> {
  const pidPath = join(agentDir, ".kern", "agent.pid");
  await mkdir(join(agentDir, ".kern"), { recursive: true });
  await writeFile(pidPath, String(pid), "utf-8");
}

export async function removePidFile(agentDir: string): Promise<void> {
  const pidPath = join(agentDir, ".kern", "agent.pid");
  try {
    await unlink(pidPath);
  } catch {}
}

export function readPid(agentDir: string): number | null {
  const pidPath = join(agentDir, ".kern", "agent.pid");
  try {
    const raw = readFileSync(pidPath, "utf-8").trim();
    const pid = parseInt(raw, 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}
