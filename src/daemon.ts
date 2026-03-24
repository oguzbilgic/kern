import { spawn } from "child_process";
import { basename } from "path";
import { existsSync } from "fs";
import { mkdir } from "fs/promises";
import { join } from "path";
import { openSync } from "fs";
import { findAgent, loadRegistry, registerAgent, setPid, isProcessRunning } from "./registry.js";

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

async function startOne(name: string, path: string): Promise<void> {
  // Check if already running
  const existing = await findAgent(name);
  if (existing?.pid && isProcessRunning(existing.pid)) {
    console.log(`  ${green("●")} ${bold(name)} already running ${dim(`(pid ${existing.pid})`)}`);
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

  // Fork detached process
  const child = spawn("node", ["--no-deprecation", kernBin, path], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    cwd: path,
  });

  child.unref();

  const pid = child.pid!;
  await registerAgent(name, path);
  await setPid(name, pid);

  console.log(`  ${green("●")} ${bold(name)} started ${dim(`(pid ${pid})`)}`);
}

export async function startAgent(name?: string): Promise<void> {
  if (name) {
    // Start specific agent
    const agent = await findAgent(name);
    if (!agent) {
      console.error(`Agent not found: ${name}`);
      console.error("Use an agent name from 'kern status'.");
      process.exit(1);
      return;
    }
    console.log("");
    await startOne(agent.name, agent.path);
    console.log("");
  } else {
    // Start all registered agents
    const agents = await loadRegistry();
    if (agents.length === 0) {
      console.error("No agents registered. Run 'kern init <name>' first.");
      process.exit(1);
      return;
    }
    console.log("");
    console.log(`  ${bold("starting all agents")}`);
    console.log("");
    for (const agent of agents) {
      await startOne(agent.name, agent.path);
    }
    console.log("");
  }
  process.exit(0);
}

async function stopOne(name: string): Promise<void> {
  const agent = await findAgent(name);
  if (!agent) {
    console.log(`  ${dim("●")} ${bold(name)} not found`);
    return;
  }

  if (!agent.pid) {
    console.log(`  ${dim("●")} ${bold(name)} not running`);
    return;
  }

  if (!isProcessRunning(agent.pid)) {
    console.log(`  ${dim("●")} ${bold(name)} not running ${dim("(stale pid cleared)")}`);
    await setPid(name, null);
    return;
  }

  try {
    process.kill(agent.pid, "SIGTERM");
    await setPid(name, null);
    console.log(`  ${red("●")} ${bold(name)} stopped ${dim(`(was pid ${agent.pid})`)}`);
  } catch (e: any) {
    console.error(`  Failed to stop ${name}: ${e.message}`);
  }
}

export async function stopAgent(name?: string): Promise<void> {
  if (name) {
    console.log("");
    await stopOne(name);
    console.log("");
  } else {
    // Stop all
    const agents = await loadRegistry();
    if (agents.length === 0) {
      console.log("No agents registered.");
      process.exit(0);
      return;
    }
    console.log("");
    console.log(`  ${bold("stopping all agents")}`);
    console.log("");
    for (const agent of agents) {
      await stopOne(agent.name);
    }
    console.log("");
  }
  process.exit(0);
}
