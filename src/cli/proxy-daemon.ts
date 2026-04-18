import { spawn } from "child_process";
import { readFile, writeFile, unlink, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync, openSync } from "fs";
import { homedir } from "os";
import { isProcessRunning } from "../registry.js";
import { loadGlobalConfig, getProxyToken } from "../global-config.js";

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

const KERN_DIR = join(homedir(), ".kern");
const PID_FILE = join(KERN_DIR, "proxy.pid");
const LOG_FILE = join(KERN_DIR, "proxy.log");

async function readPid(): Promise<number | null> {
  if (!existsSync(PID_FILE)) return null;
  try {
    const pid = parseInt(await readFile(PID_FILE, "utf-8"), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

export async function proxyStart(): Promise<void> {
  const config = await loadGlobalConfig();
  const port = config.proxy_port;
  const token = await getProxyToken();

  const pid = await readPid();
  if (pid && isProcessRunning(pid)) {
    console.log(`\n  ${green("●")} ${bold("proxy")} already running ${dim(`(pid ${pid}, port ${port})`)}`);
    console.log(`  → http://localhost:${port}?token=${token}\n`);
    return;
  }

  await mkdir(KERN_DIR, { recursive: true });
  const logFd = openSync(LOG_FILE, "a");
  const proxyEntry = join(import.meta.dirname, "proxy.js");

  const child = spawn("node", ["--no-deprecation", proxyEntry], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
  });

  child.unref();
  const newPid = child.pid!;
  await writeFile(PID_FILE, String(newPid));

  await new Promise((r) => setTimeout(r, 1000));

  if (isProcessRunning(newPid)) {
    console.log(`\n  ${green("●")} ${bold("proxy")} started ${dim(`(pid ${newPid}, port ${port})`)}`);
    console.log(`  → http://localhost:${port}?token=${token}\n`);
  } else {
    try { await unlink(PID_FILE); } catch {}
    console.log(`\n  ${red("●")} ${bold("proxy")} failed to start\n`);
    try {
      const log = await readFile(LOG_FILE, "utf-8");
      const lines = log.trim().split("\n").slice(-5);
      for (const line of lines) {
        console.log(`    ${dim(line)}`);
      }
    } catch {}
  }
}

export async function proxyStop(): Promise<void> {
  const pid = await readPid();
  if (!pid || !isProcessRunning(pid)) {
    console.log(`\n  ${dim("●")} ${bold("proxy")} not running\n`);
    try { await unlink(PID_FILE); } catch {}
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
    try { await unlink(PID_FILE); } catch {}
    console.log(`\n  ${red("●")} ${bold("proxy")} stopped ${dim(`(was pid ${pid})`)}\n`);
  } catch (e: any) {
    console.error(`  Failed to stop proxy: ${e.message}`);
  }
}

export async function proxyStatus(): Promise<void> {
  const config = await loadGlobalConfig();
  const { getProxyServiceStatus } = await import("./install.js");
  const installStatus = getProxyServiceStatus();

  const pid = await readPid();
  const pidRunning = pid && isProcessRunning(pid);
  const running = pidRunning || installStatus === "active";
  const mode = installStatus ? "systemd" : pidRunning ? "daemon" : "—";

  if (running) {
    console.log(`\n  ${green("●")} ${bold("proxy")} running ${dim(`(:${config.proxy_port})`)}`);
  } else {
    console.log(`\n  ${dim("●")} ${bold("proxy")} stopped`);
    if (pid) {
      try { await unlink(PID_FILE); } catch {}
    }
  }
  console.log(`    ${dim("mode:")} ${mode}\n`);
}

export async function proxyToken(): Promise<void> {
  const config = await loadGlobalConfig();
  const token = await getProxyToken();
  console.log(`\n  → http://localhost:${config.proxy_port}?token=${token}\n`);
}
