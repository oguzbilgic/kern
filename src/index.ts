#!/usr/bin/env -S node --no-deprecation

import { resolve } from "path";
import { existsSync } from "fs";
import { startApp } from "./app.js";
import { runInit } from "./init.js";
import { showStatus } from "./status.js";
import { startAgent, stopAgent } from "./daemon.js";
import { findAgent, loadRegistry } from "./registry.js";
import { readFile } from "fs/promises";
import { join } from "path";

const args = process.argv.slice(2);
const cmd = args[0];

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

async function showHelp() {
  let version = "unknown";
  try {
    const pkg = JSON.parse(await readFile(join(import.meta.dirname, "..", "package.json"), "utf-8"));
    version = pkg.version;
  } catch {}

  const w = (s: string) => process.stdout.write(s + "\n");
  w("");
  w(`  ${bold("kern")} ${dim("v" + version)}`);
  w(`  ${dim("One agent. One folder. One continuous conversation.")}`);
  w("");
  w(`  ${yellow("Commands")}`);
  w(`    ${cyan("kern init")} ${dim("<name>")}            create or configure an agent`);
  w(`    ${cyan("kern start")} ${dim("[name|path]")}      start agents`);
  w(`    ${cyan("kern stop")} ${dim("[name]")}            stop agents`);
  w(`    ${cyan("kern restart")} ${dim("[name]")}         restart agents`);
  w(`    ${cyan("kern list")}                   show all agents`);
  w(`    ${cyan("kern remove")} ${dim("<name>")}          unregister an agent`);
  w(`    ${cyan("kern pair")} ${dim("<agent> <code>")}    approve a pairing code`);
  w(`    ${cyan("kern backup")} ${dim("<name>")}          backup agent to .tar.gz`);
  w(`    ${cyan("kern import")} ${dim("opencode <name>")}  import session from OpenCode`);
  w(`    ${cyan("kern restore")} ${dim("<file>")}         restore agent from backup`);
  w(`    ${cyan("kern logs")} ${dim("[name]")}            tail agent logs`);
    w(`    ${cyan("kern tui")} ${dim("[name]")}             interactive chat`);
    w(`    ${cyan("kern web")} ${dim("<start|stop|status>")}  web UI server`);
  w("");
}

async function resolveAgentDir(nameOrPath?: string): Promise<string> {
  if (nameOrPath) {
    // Check registry
    const agent = await findAgent(nameOrPath);
    if (agent) return agent.path;

    // Check path
    const dir = resolve(nameOrPath);
    if (existsSync(dir) && (existsSync(join(dir, ".kern")) || existsSync(join(dir, "AGENTS.md")))) {
      return dir;
    }

    console.error(`Agent not found: ${nameOrPath}`);
    process.exit(1);
  }

  // No arg — auto-select
  const agents = await loadRegistry();
  if (agents.length === 0) {
    console.error("No agents registered. Run 'kern init <name>' first.");
    process.exit(1);
  }
  if (agents.length === 1) {
    return agents[0].path;
  }

  // Multiple agents — prompt to select
  const { select } = await import("@inquirer/prompts");
  return select({
    message: "Select agent",
    choices: agents.map((a) => ({ name: a.name, value: a.path })),
  });
}

async function main() {
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    await showHelp();
    process.exit(0);
  }

  if (cmd === "init") {
    // Parse flags for non-interactive mode
    const flags: Record<string, string> = {};
    let initTarget = args[1];
    for (let i = 1; i < args.length; i++) {
      if (args[i].startsWith("--") && i + 1 < args.length && !args[i + 1].startsWith("--")) {
        flags[args[i].slice(2)] = args[i + 1];
        i++;
      } else if (!args[i].startsWith("--")) {
        initTarget = args[i];
      }
    }
    await runInit(initTarget, Object.keys(flags).length > 0 ? flags : undefined);
    return;
  }

  if (cmd === "list" || cmd === "ls" || cmd === "status") {
    await showStatus();
    process.exit(0);
  }

  if (cmd === "start") {
    await startAgent(args[1]);
    process.exit(0);
  }

  if (cmd === "stop") {
    await stopAgent(args[1]);
    process.exit(0);
  }

  if (cmd === "restart") {
    await stopAgent(args[1]);
    await new Promise((r) => setTimeout(r, 500));
    await startAgent(args[1]);
    process.exit(0);
  }

  if (cmd === "remove" || cmd === "rm") {
    const name = args[1];
    if (!name) {
      console.error("Usage: kern remove <name>");
      process.exit(1);
    }
    const { removeAgent, findAgent, isProcessRunning } = await import("./registry.js");
    const { stopAgent } = await import("./daemon.js");
    const agent = await findAgent(name);
    if (!agent) {
      console.error(`Agent not found: ${name}`);
      process.exit(1);
    }
    if (agent.pid && isProcessRunning(agent.pid)) {
      await stopAgent(name);
    }
    await removeAgent(name);
    console.log(`  Removed ${name}`);
    process.exit(0);
  }

  if (cmd === "logs") {
    const agentDir = await resolveAgentDir(args[1]);
    const logFile = join(agentDir, ".kern", "logs", "kern.log");
    const { existsSync } = await import("fs");
    if (!existsSync(logFile)) {
      console.error("No logs yet. Start the agent first.");
      process.exit(1);
    }
    const { spawn } = await import("child_process");
    const tail = spawn("tail", ["-f", logFile], { stdio: "inherit" });
    process.on("SIGINT", () => { tail.kill(); process.exit(0); });
    return;
  }

  if (cmd === "import") {
    const source = args[1]; // "opencode"
    if (source === "opencode") {
      const { importOpenCode } = await import("./import.js");
      await importOpenCode(args.slice(2));
    } else {
      console.error("Usage: kern import opencode [--project <path>] [--session <title|latest>] [--agent <name>]");
      process.exit(1);
    }
    return;
  }

  if (cmd === "pair") {
    const agentName = args[1];
    const code = args[2];
    if (!agentName || !code) {
      console.error("Usage: kern pair <agent> <code>");
      process.exit(1);
    }
    const { findAgent } = await import("./registry.js");
    const { PairingManager } = await import("./pairing.js");
    const agent = await findAgent(agentName);
    if (!agent) {
      console.error(`Agent not found: ${agentName}`);
      process.exit(1);
    }
    const pairing = new PairingManager(agent.path);
    await pairing.load();
    const result = await pairing.pair(code);
    if (result) {
      console.log(`  Paired user ${result.userId} (${result.interface}) to ${agentName}`);
    } else {
      console.error(`  Invalid or expired code: ${code}`);
    }
    process.exit(0);
  }

  if (cmd === "backup") {
    const { backupAgent } = await import("./backup.js");
    await backupAgent(args[1]);
    return;
  }

  if (cmd === "restore") {
    const { restoreAgent } = await import("./backup.js");
    await restoreAgent(args[1]);
    return;
  }

  if (cmd === "tui") {
    const { connectTui } = await import("./tui.js");
    const { findAgent, loadRegistry } = await import("./registry.js");
    const { startAgent } = await import("./daemon.js");

    let agentName = args[1];

    // Auto-select if no arg
    if (!agentName) {
      const agents = await loadRegistry();
      if (agents.length === 0) {
        console.error("No agents registered. Run 'kern init <name>' first.");
        process.exit(1);
      } else if (agents.length === 1) {
        agentName = agents[0].name;
      } else {
        const { select } = await import("@inquirer/prompts");
        agentName = await select({
          message: "Select agent",
          choices: agents.map((a) => ({ name: a.name, value: a.name })),
        });
      }
    }

    // Check if running, auto-start if not
    let agent = await findAgent(agentName);
    if (!agent) {
      console.error(`Agent not found: ${agentName}`);
      process.exit(1);
    }

    const { isProcessRunning } = await import("./registry.js");
    if (!agent.pid || !isProcessRunning(agent.pid)) {
      await startAgent(agentName);
      // Reload to get the port
      agent = await findAgent(agentName);
    }

    if (!agent?.port) {
      console.error(`Cannot determine port for ${agentName}. Is it running?`);
      process.exit(1);
    }

    // Read auth token from agents.json registry
    const authToken = agent.token || undefined;

    await connectTui(agent.port, agentName, authToken);
    return;
  }

  if (cmd === "run") {
    const agentDir = await resolveAgentDir(args[1]);
    await startApp(agentDir);
    return;
  }

  if (cmd === "web") {
    const subcmd = args[1]; // start, stop, status
    const { webStart, webStop, webStatus } = await import("./web-daemon.js");
    if (subcmd === "start") {
      await webStart();
    } else if (subcmd === "stop") {
      await webStop();
    } else if (subcmd === "status") {
      await webStatus();
    } else {
      console.error("Usage: kern web <start|stop|status>");
      process.exit(1);
    }
    return;
  }

  console.error(`Unknown command: ${cmd}`);
  await showHelp();
  process.exit(1);
}

main().catch((error) => {
  console.error("Fatal:", error.message);
  process.exit(1);
});
