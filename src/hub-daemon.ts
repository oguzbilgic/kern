import { spawn } from "child_process";
import { readFile, writeFile, unlink, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync, openSync } from "fs";
import { homedir } from "os";
import { isProcessRunning } from "./registry.js";
import { loadGlobalConfig } from "./global-config.js";

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

const HUB_DIR = join(homedir(), ".kern", "hub");
const PID_FILE = join(HUB_DIR, "hub.pid");
const LOG_FILE = join(HUB_DIR, "hub.log");

async function readPid(): Promise<number | null> {
  if (!existsSync(PID_FILE)) return null;
  try {
    const pid = parseInt(await readFile(PID_FILE, "utf-8"), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

export async function hubStart(): Promise<void> {
  const config = await loadGlobalConfig();
  const port = config.hub_port || 4000;

  const pid = await readPid();
  if (pid && isProcessRunning(pid)) {
    console.log(`\n  ${green("●")} ${bold("hub")} already running ${dim(`(pid ${pid}, port ${port})`)}\n`);
    return;
  }

  await mkdir(HUB_DIR, { recursive: true });
  const logFd = openSync(LOG_FILE, "a");
  const hubEntry = join(import.meta.dirname, "hub.js");

  const child = spawn("node", ["--no-deprecation", hubEntry, String(port)], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });

  child.unref();
  const newPid = child.pid!;
  await writeFile(PID_FILE, String(newPid));

  await new Promise((r) => setTimeout(r, 1000));

  if (isProcessRunning(newPid)) {
    console.log(`\n  ${green("●")} ${bold("hub")} started ${dim(`(pid ${newPid}, port ${port})`)}\n`);
  } else {
    try { await unlink(PID_FILE); } catch {}
    console.log(`\n  ${red("●")} ${bold("hub")} failed to start\n`);
    try {
      const log = await readFile(LOG_FILE, "utf-8");
      const lines = log.trim().split("\n").slice(-5);
      for (const line of lines) {
        console.log(`    ${dim(line)}`);
      }
    } catch {}
  }
}

export async function hubStop(): Promise<void> {
  const pid = await readPid();
  if (!pid || !isProcessRunning(pid)) {
    console.log(`\n  ${dim("●")} ${bold("hub")} not running\n`);
    try { await unlink(PID_FILE); } catch {}
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
    try { await unlink(PID_FILE); } catch {}
    console.log(`\n  ${red("●")} ${bold("hub")} stopped ${dim(`(was pid ${pid})`)}\n`);
  } catch (e: any) {
    console.error(`  Failed to stop hub: ${e.message}`);
  }
}

export async function hubStatus(): Promise<void> {
  const config = await loadGlobalConfig();
  const port = config.hub_port || 4000;
  const pid = await readPid();
  if (pid && isProcessRunning(pid)) {
    console.log(`\n  ${green("●")} ${bold("hub")} running ${dim(`(pid ${pid}, port ${port})`)}\n`);
  } else {
    console.log(`\n  ${dim("●")} ${bold("hub")} stopped\n`);
    if (pid) {
      try { await unlink(PID_FILE); } catch {}
    }
  }
}
