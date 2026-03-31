import { spawn } from "child_process";
import { readFile, writeFile, unlink, mkdir, appendFile } from "fs/promises";
import { join } from "path";
import { existsSync, openSync } from "fs";
import { homedir } from "os";
import { randomBytes } from "crypto";
import { isProcessRunning } from "./registry.js";
import { loadGlobalConfig } from "./global-config.js";

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

const KERN_DIR = join(homedir(), ".kern");
const PID_FILE = join(KERN_DIR, "web.pid");
const LOG_FILE = join(KERN_DIR, "web.log");
const ENV_FILE = join(KERN_DIR, ".env");

/** Read or generate the web token from ~/.kern/.env */
async function getWebToken(): Promise<string> {
  if (existsSync(ENV_FILE)) {
    const content = await readFile(ENV_FILE, "utf-8");
    const match = content.match(/^KERN_WEB_TOKEN=(.+)$/m);
    if (match) return match[1].trim();
  }
  const token = randomBytes(16).toString("hex");
  await appendFile(ENV_FILE, `${existsSync(ENV_FILE) ? "\n" : ""}KERN_WEB_TOKEN=${token}\n`);
  return token;
}

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
  const token = await getWebToken();

  // Check if already running
  const pid = await readPid();
  if (pid && isProcessRunning(pid)) {
    console.log(`\n  ${green("●")} ${bold("web")} already running ${dim(`(pid ${pid}, port ${port})`)}`);
    console.log(`  → http://localhost:${port}?token=${token}\n`);
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

  // Wait and verify
  await new Promise((r) => setTimeout(r, 1000));

  if (isProcessRunning(newPid)) {
    console.log(`\n  ${green("●")} ${bold("web")} started ${dim(`(pid ${newPid}, port ${port})`)}`);
    console.log(`  → http://localhost:${port}?token=${token}\n`);
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
  const pid = await readPid();
  if (pid && isProcessRunning(pid)) {
    console.log(`\n  ${green("●")} ${bold("web")} running ${dim(`(pid ${pid}, port ${config.web_port})`)}\n`);
  } else {
    console.log(`\n  ${dim("●")} ${bold("web")} stopped\n`);
    if (pid) {
      try { await unlink(PID_FILE); } catch {}
    }
  }
}

export async function webToken(): Promise<void> {
  const config = await loadGlobalConfig();
  const token = await getWebToken();
  console.log(`\n  → http://localhost:${config.web_port}?token=${token}\n`);
}
