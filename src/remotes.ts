import { readFile, writeFile, mkdir, open, unlink, stat } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { homedir } from "os";

export interface RemoteEntry {
  name: string;
  host: string;
  port: number;
}

const KERN_DIR = join(homedir(), ".kern");
const REMOTES_FILE = join(KERN_DIR, "remotes.json");
const LOCK_FILE = join(KERN_DIR, "remotes.lock");

const LOCK_STALE_MS = 10_000;
const LOCK_RETRY_MS = 50;
const LOCK_TIMEOUT_MS = 5_000;

async function acquireLock(): Promise<void> {
  await mkdir(KERN_DIR, { recursive: true });
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (true) {
    try {
      const fh = await open(LOCK_FILE, "wx");
      await fh.write(String(process.pid));
      await fh.close();
      return;
    } catch (e: any) {
      if (e.code !== "EEXIST") throw e;
      try {
        const st = await stat(LOCK_FILE);
        if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
          try { await unlink(LOCK_FILE); } catch {}
          continue;
        }
      } catch {}
      if (Date.now() >= deadline) {
        try { await unlink(LOCK_FILE); } catch {}
        throw new Error("Timed out acquiring remotes lock");
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

export async function loadRemotes(): Promise<RemoteEntry[]> {
  if (!existsSync(REMOTES_FILE)) return [];
  try {
    const raw = await readFile(REMOTES_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveRemotes(remotes: RemoteEntry[]): Promise<void> {
  await mkdir(KERN_DIR, { recursive: true });
  await writeFile(REMOTES_FILE, JSON.stringify(remotes, null, 2) + "\n", "utf-8");
}

export async function findRemote(name: string): Promise<RemoteEntry | null> {
  const remotes = await loadRemotes();
  return remotes.find((r) => r.name === name) || null;
}

export async function addRemote(name: string, host: string, port: number): Promise<void> {
  await withLock(async () => {
    const remotes = await loadRemotes();
    const existing = remotes.findIndex((r) => r.name === name);
    if (existing >= 0) {
      remotes[existing] = { name, host, port };
    } else {
      remotes.push({ name, host, port });
    }
    await saveRemotes(remotes);
  });
}

export async function removeRemote(name: string): Promise<boolean> {
  return withLock(async () => {
    const remotes = await loadRemotes();
    const idx = remotes.findIndex((r) => r.name === name);
    if (idx < 0) return false;
    remotes.splice(idx, 1);
    await saveRemotes(remotes);
    return true;
  });
}
