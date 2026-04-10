import { writeFile, mkdir, unlink } from "fs/promises";
import { join, basename } from "path";
import { existsSync, readFileSync } from "fs";
import { createServer } from "net";
import { parse as parseDotenv } from "dotenv";
import { loadGlobalConfig, loadGlobalConfigSync, saveGlobalConfig } from "./global-config.js";
import { log } from "./log.js";

/**
 * Agent registry backed by ~/.kern/config.json `agents` field.
 * All agent runtime state (port, token, PID) lives in the agent's own .kern/ directory.
 */

export interface AgentInfo {
  name: string;
  path: string;
  port: number;
  token: string | null;
  pid: number | null;
}

// --- Registry: reads/writes config.agents ---

export async function loadRegistry(): Promise<string[]> {
  const config = await loadGlobalConfig();
  return config.agents;
}

export async function registerAgent(path: string): Promise<void> {
  const config = await loadGlobalConfig();
  if (!config.agents.includes(path)) {
    config.agents.push(path);
    await saveGlobalConfig(config);
  }
}

export async function removeAgent(nameOrPath: string): Promise<boolean> {
  const config = await loadGlobalConfig();
  // Try direct path match
  let idx = config.agents.indexOf(nameOrPath);
  // Try name match
  if (idx < 0) {
    for (let i = 0; i < config.agents.length; i++) {
      const info = readAgentInfo(config.agents[i]);
      if (info && info.name === nameOrPath) {
        idx = i;
        break;
      }
    }
  }
  if (idx < 0) return false;
  config.agents.splice(idx, 1);
  await saveGlobalConfig(config);
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
    const envRaw = readFileSync(envPath, "utf-8");
    const env = parseDotenv(envRaw);
    token = env.KERN_AUTH_TOKEN || null;
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
  const config = loadGlobalConfigSync();

  for (const p of config.agents) {
    const info = readAgentInfo(p);
    if (!info) continue;
    if (info.name === nameOrPath || info.path === nameOrPath || p === nameOrPath) {
      return info;
    }
  }
  return null;
}

/**
 * Check if a port is available by attempting to bind it.
 */
function checkPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, "0.0.0.0", () => {
      srv.close(() => resolve(true));
    });
  });
}

/**
 * Assign a sticky port to an agent. Picks from 4100-4999, skipping registry-known ports
 * and bind-checking to avoid cross-user collisions.
 */
export async function assignPort(): Promise<number> {
  const config = loadGlobalConfigSync();
  const knownPorts = new Set<number>();
  for (const p of config.agents) {
    const info = readAgentInfo(p);
    if (info && info.port > 0) knownPorts.add(info.port);
  }

  for (let port = 4100; port <= 4999; port++) {
    if (knownPorts.has(port)) continue;
    if (await checkPort(port)) {
      if (port > 4100) {
        log("kern", `assigned port ${port} (${port - 4100} skipped)`);
      }
      return port;
    }
    log.debug("kern", `port ${port} in use, trying ${port + 1}`);
  }

  log.warn("kern", "port range 4100-4999 exhausted, falling back to OS-assigned port");
  return 0;
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
