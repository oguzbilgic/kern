#!/usr/bin/env -S node --no-deprecation

import { resolve } from "path";
import { existsSync } from "fs";
import { startApp } from "./app.js";
import { runInit } from "./init.js";
import { showStatus } from "./status.js";
import { startAgent, stopAgent } from "./daemon.js";
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
  w(`    ${cyan("kern list")}                   show all agents`);
  w(`    ${cyan("kern run")} ${dim("<name|path>")}        run in foreground`);
  w("");
}

if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
  showHelp().then(() => process.exit(0));
} else if (cmd === "init") {
  runInit(args[1]).catch((error) => {
    console.error("Error:", error.message);
    process.exit(1);
  });
} else if (cmd === "list" || cmd === "ls" || cmd === "status") {
  showStatus().then(() => process.exit(0)).catch((error) => {
    console.error("Error:", error.message);
    process.exit(1);
  });
} else if (cmd === "start") {
  startAgent(args[1]).catch((error) => {
    console.error("Error:", error.message);
    process.exit(1);
  });
} else if (cmd === "stop") {
  stopAgent(args[1]).catch((error) => {
    console.error("Error:", error.message);
    process.exit(1);
  });
} else if (cmd === "run") {
  // Foreground mode — resolve name or path
  const nameOrPath = args[1];
  if (!nameOrPath) {
    console.error("Usage: kern run <name|path>");
    process.exit(1);
  }

  // Try registry first, then path
  import("./registry.js").then(async ({ findAgent, registerAgent }) => {
    let agentDir: string;
    const agent = await findAgent(nameOrPath);
    if (agent) {
      agentDir = agent.path;
    } else {
      agentDir = resolve(nameOrPath);
      if (!existsSync(agentDir)) {
        console.error(`Agent not found: ${nameOrPath}`);
        process.exit(1);
        return;
      }
    }

    if (!existsSync(resolve(agentDir, ".kern")) && !existsSync(resolve(agentDir, "AGENTS.md"))) {
      console.error(`Not an agent directory: ${agentDir}`);
      process.exit(1);
      return;
    }

    startApp(agentDir).catch((error) => {
      console.error("Fatal:", error.message);
      process.exit(1);
    });
  });
} else {
  console.error(`Unknown command: ${cmd}`);
  showHelp().then(() => process.exit(1));
}
