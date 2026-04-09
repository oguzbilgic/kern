import { readFile, writeFile, mkdir } from "fs/promises";
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

// Legacy format for migration
interface LegacyAgentEntry {
  name: string;
  path: string;
  pid?: number | null;
  port?: number | null;
  token?: string | null;
  addedAt: string;
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
    const parsed = JSON.parse(raw);

    // Migrate legacy format: array of objects → array of strings
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === "object") {
      const legacy = parsed as LegacyAgentEntry[];
      const paths = legacy.map((a) => a.path);
      await saveRegistry(paths);
      // Migrate tokens to agent .env files
      for (const entry of legacy) {
        if (entry.token) {
          await migrateTokenToAgent(entry.path, entry.token);
        }
      }
      return paths;
    }

    return parsed as string[];
  } catch {
    return [];
  }
}

async function saveRegistry(paths: string[]): Promise<void> {
  await ensureDir();
  await writeFile(AGENTS_FILE, JSON.stringify(paths, null, 2) + "\n", "utf-8");
}

async function migrateTokenToAgent(agentPath: string, token: string): Promise<void> {
  const envPath = join(agentPath, ".kern", ".env");
  try {
    if (existsSync(envPath)) {
      const content = await readFile(envPath, "utf-8");
      if (content.includes("KERN_TOKEN=")) return; // already has token
      // Migrate old KERN_AUTH_TOKEN to KERN_TOKEN
      if (content.includes("KERN_AUTH_TOKEN=")) return; // will be renamed on load
    }
    await mkdir(join(agentPath, ".kern"), { recursive: true });
    const { appendFile } = await import("fs/promises");
    await appendFile(envPath, `KERN_TOKEN=${token}\n`);
  } catch {}
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
    // Check KERN_TOKEN first, fall back to legacy KERN_AUTH_TOKEN
    token = env.parsed?.KERN_TOKEN || env.parsed?.KERN_AUTH_TOKEN || null;
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
    const parsed = JSON.parse(raw);
    // Handle legacy format synchronously
    if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === "object") {
      paths = (parsed as LegacyAgentEntry[]).map((a) => a.path);
    } else {
      paths = parsed as string[];
    }
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
    const { unlink } = await import("fs/promises");
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
