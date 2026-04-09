import { spawn } from "child_process";
import { basename } from "path";
import { existsSync } from "fs";
import { mkdir } from "fs/promises";
import { join } from "path";
import { openSync } from "fs";
import { findAgent, loadRegistry, registerAgent, readAgentInfo, readPid, writePidFile, removePidFile, isProcessRunning } from "./registry.js";
import { isServiceInstalled } from "./install.js";

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

async function startOne(name: string, path: string): Promise<void> {
  // Check if already running via PID file
  const existingPid = readPid(path);
  if (existingPid && isProcessRunning(existingPid)) {
    console.log(`  ${green("●")} ${bold(name)} already running ${dim(`(pid ${existingPid})`)}`);
    return;
  }

  if (!existsSync(path)) {
    console.log(`  ${red("●")} ${bold(name)} path not found: ${path}`);
    return;
  }

  // Ensure log directory
  const logDir = join(path, ".kern", "logs");
  await mkdir(logDir, { recursive: true });
  const logFile = join(logDir, "kern.log");
  const logFd = openSync(logFile, "a");

  // Find the kern entry point
  const kernBin = join(import.meta.dirname, "index.js");

  // Fork detached process using kern run
  const child = spawn("node", ["--no-deprecation", kernBin, "run", path], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    cwd: path,
  });

  child.unref();

  const pid = child.pid!;
  await registerAgent(path);
  await writePidFile(path, pid);

  // Wait and verify the process stays alive
  await new Promise((resolve) => setTimeout(resolve, 2000));

  if (isProcessRunning(pid)) {
    const info = readAgentInfo(path);
    const portStr = info?.port ? `, :${info.port}` : "";
    console.log(`  ${green("●")} ${bold(name)} started ${dim(`(pid ${pid}${portStr})`)}`);
    if (!isServiceInstalled(name)) {
      try {
        const { execSync } = await import("child_process");
        execSync("which systemctl", { stdio: "ignore" });
        console.log(`  ${dim(`tip: 'kern install ${name}' enables auto-restart and boot persistence`)}`);
      } catch {}
    }
  } else {
    await removePidFile(path);
    console.log(`  ${red("●")} ${bold(name)} failed to start`);
    // Show last few lines of log
    try {
      const { readFile } = await import("fs/promises");
      const log = await readFile(logFile, "utf-8");
      const lines = log.trim().split("\n").slice(-5);
      for (const line of lines) {
        console.log(`    ${dim(line)}`);
      }
    } catch {}
  }
}

export async function startAgent(nameOrPath?: string): Promise<void> {
  if (nameOrPath) {
    // Try registry first
    let agent = findAgent(nameOrPath);

    if (!agent) {
      // Check if it's a directory path
      const { resolve } = await import("path");
      const dir = resolve(nameOrPath);
      if (existsSync(dir) && (existsSync(join(dir, ".kern")) || existsSync(join(dir, "AGENTS.md")))) {
        const name = basename(dir);
        await registerAgent(dir);
        agent = { name, path: dir, port: 0, token: null, pid: null };
      }
    }

    if (!agent) {
      console.error(`Agent not found: ${nameOrPath}`);
      console.error("Use an agent name from 'kern status' or a path to an agent directory.");
      process.exit(1);
      return;
    }
    console.log("");
    await startOne(agent.name, agent.path);
    console.log("");
  } else {
    // Start all registered agents
    const paths = await loadRegistry();
    if (paths.length === 0) {
      console.error("No agents registered. Run 'kern init <name>' first.");
      process.exit(1);
      return;
    }
    console.log("");
    console.log(`  ${bold("starting all agents")}`);
    console.log("");
    for (const agentPath of paths) {
      const info = readAgentInfo(agentPath);
      const name = info?.name || basename(agentPath);
      await startOne(name, agentPath);
    }
    console.log("");
  }
}

async function stopOne(name: string, agentPath: string): Promise<void> {
  const pid = readPid(agentPath);

  if (!pid) {
    console.log(`  ${dim("●")} ${bold(name)} not running`);
    return;
  }

  if (!isProcessRunning(pid)) {
    console.log(`  ${dim("●")} ${bold(name)} not running ${dim("(stale pid cleared)")}`);
    await removePidFile(agentPath);
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
    await removePidFile(agentPath);
    console.log(`  ${red("●")} ${bold(name)} stopped ${dim(`(was pid ${pid})`)}`);
  } catch (e: any) {
    console.error(`  Failed to stop ${name}: ${e.message}`);
  }
}

export async function stopAgent(name?: string): Promise<void> {
  if (name) {
    const agent = findAgent(name);
    if (!agent) {
      console.error(`Agent not found: ${name}`);
      process.exit(1);
      return;
    }
    console.log("");
    await stopOne(agent.name, agent.path);
    console.log("");
  } else {
    // Stop all
    const paths = await loadRegistry();
    if (paths.length === 0) {
      console.log("No agents registered.");
      process.exit(0);
      return;
    }
    console.log("");
    console.log(`  ${bold("stopping all agents")}`);
    console.log("");
    for (const agentPath of paths) {
      const info = readAgentInfo(agentPath);
      const name = info?.name || basename(agentPath);
      await stopOne(name, agentPath);
    }
    console.log("");
  }
}
