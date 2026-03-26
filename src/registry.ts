import { readFile, writeFile, mkdir, open, unlink, stat } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { homedir } from "os";

export interface AgentEntry {
  name: string;
  path: string;
  pid?: number | null;
  port?: number | null;
  addedAt: string;
}

const KERN_DIR = join(homedir(), ".kern");
const AGENTS_FILE = join(KERN_DIR, "agents.json");
const LOCK_FILE = join(KERN_DIR, "agents.lock");

async function ensureDir(): Promise<void> {
  await mkdir(KERN_DIR, { recursive: true });
}

// File-based lock to prevent concurrent read-modify-write races.
// Uses O_CREAT|O_EXCL which atomically fails if the file exists.
const LOCK_STALE_MS = 10_000;
const LOCK_RETRY_MS = 50;
const LOCK_TIMEOUT_MS = 5_000;

async function acquireLock(): Promise<void> {
  await ensureDir();
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (true) {
    try {
      // O_CREAT | O_EXCL: atomic create-or-fail
      const fh = await open(LOCK_FILE, "wx");
      await fh.write(String(process.pid));
      await fh.close();
      return;
    } catch (e: any) {
      if (e.code !== "EEXIST") throw e;

      // Check if lock is stale (holder crashed)
      try {
        const st = await stat(LOCK_FILE);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          try { await unlink(LOCK_FILE); } catch {}
          continue;
        }
      } catch {}

      if (Date.now() >= deadline) {
        // Last resort: remove potentially stale lock and retry once
        try { await unlink(LOCK_FILE); } catch {}
        throw new Error("Timed out acquiring registry lock");
      }
      await new Promise((r) => setTimeout(r, LOCK_RETRY_MS));
    }
  }
}

async function releaseLock(): Promise<void> {
  try { await unlink(LOCK_FILE); } catch {}
}

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  await acquireLock();
  try {
    return await fn();
  } finally {
    await releaseLock();
  }
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
  await withLock(async () => {
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
  });
}

export async function findAgent(nameOrPath: string): Promise<AgentEntry | null> {
  const agents = await loadRegistry();
  return agents.find((a) => a.name === nameOrPath || a.path === nameOrPath) || null;
}

export async function setPid(nameOrPath: string, pid: number | null): Promise<void> {
  await withLock(async () => {
    const agents = await loadRegistry();
    const agent = agents.find((a) => a.name === nameOrPath || a.path === nameOrPath);
    if (agent) {
      agent.pid = pid;
      if (!pid) agent.port = null;
      await saveRegistry(agents);
    }
  });
}

export async function setPort(nameOrPath: string, port: number | null): Promise<void> {
  await withLock(async () => {
    const agents = await loadRegistry();
    const agent = agents.find((a) => a.name === nameOrPath || a.path === nameOrPath);
    if (agent) {
      agent.port = port;
      await saveRegistry(agents);
    }
  });
}

export async function removeAgent(nameOrPath: string): Promise<boolean> {
  return withLock(async () => {
    const agents = await loadRegistry();
    const idx = agents.findIndex((a) => a.name === nameOrPath || a.path === nameOrPath);
    if (idx < 0) return false;
    agents.splice(idx, 1);
    await saveRegistry(agents);
    return true;
  });
}

export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
