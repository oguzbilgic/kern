import { readFile, writeFile, mkdir } from "fs/promises";
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
  const remotes = await loadRemotes();
  const existing = remotes.findIndex((r) => r.name === name);
  if (existing >= 0) {
    remotes[existing] = { name, host, port };
  } else {
    remotes.push({ name, host, port });
  }
  await saveRemotes(remotes);
}

export async function removeRemote(name: string): Promise<boolean> {
  const remotes = await loadRemotes();
  const idx = remotes.findIndex((r) => r.name === name);
  if (idx < 0) return false;
  remotes.splice(idx, 1);
  await saveRemotes(remotes);
  return true;
}
