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

const KERN_DIR = join(homedir(), ".kern");
const PID_FILE = join(KERN_DIR, "web.pid");
const LOG_FILE = join(KERN_DIR, "web.log");

async function readPid(): Promise<number | null> {
  if (!existsSync(PID_FILE)) return null;
  try {
    const pid = parseInt(await readFile(PID_FILE, "utf-8"), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

export async function webStart(): Promise<void> {
  const config = await loadGlobalConfig();
  const port = config.web_port;

  const pid = await readPid();
  if (pid && isProcessRunning(pid)) {
    console.log(`\n  ${green("●")} ${bold("web")} already running ${dim(`(pid ${pid}, port ${port})`)}`);
    console.log(`  → http://localhost:${port}\n`);
    return;
  }

  await mkdir(KERN_DIR, { recursive: true });
  const logFd = openSync(LOG_FILE, "a");
  const webEntry = join(import.meta.dirname, "web.js");

  const child = spawn("node", ["--no-deprecation", webEntry], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });

  child.unref();
  const newPid = child.pid!;
  await writeFile(PID_FILE, String(newPid));

  await new Promise((r) => setTimeout(r, 1000));

  if (isProcessRunning(newPid)) {
    console.log(`\n  ${green("●")} ${bold("web")} started ${dim(`(pid ${newPid}, port ${port})`)}`);
    console.log(`  → http://localhost:${port}\n`);
  } else {
    try { await unlink(PID_FILE); } catch {}
    console.log(`\n  ${red("●")} ${bold("web")} failed to start\n`);
    try {
      const log = await readFile(LOG_FILE, "utf-8");
      const lines = log.trim().split("\n").slice(-5);
      for (const line of lines) {
        console.log(`    ${dim(line)}`);
      }
    } catch {}
  }
}

export async function webStop(): Promise<void> {
  const pid = await readPid();
  if (!pid || !isProcessRunning(pid)) {
    console.log(`\n  ${dim("●")} ${bold("web")} not running\n`);
    try { await unlink(PID_FILE); } catch {}
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
    try { await unlink(PID_FILE); } catch {}
    console.log(`\n  ${red("●")} ${bold("web")} stopped ${dim(`(was pid ${pid})`)}\n`);
  } catch (e: any) {
    console.error(`  Failed to stop web: ${e.message}`);
  }
}

export async function webStatus(): Promise<void> {
  const config = await loadGlobalConfig();
  const { getWebServiceStatus } = await import("./install.js");
  const installStatus = getWebServiceStatus();

  const pid = await readPid();
  const pidRunning = pid && isProcessRunning(pid);
  const running = pidRunning || installStatus === "active";
  const mode = installStatus ? "systemd" : pidRunning ? "daemon" : "—";

  if (running) {
    console.log(`\n  ${green("●")} ${bold("web")} running ${dim(`(:${config.web_port})`)}`);
  } else {
    console.log(`\n  ${dim("●")} ${bold("web")} stopped`);
    if (pid) {
      try { await unlink(PID_FILE); } catch {}
    }
  }
  console.log(`    ${dim("mode:")} ${mode}\n`);
}
