// Shared helpers for CLI command handlers.

import { resolve, join } from "path";
import { existsSync } from "fs";
import { findAgent, loadRegistry, readAgentInfo } from "../registry.js";

// Resolve an agent directory from a name or path, or prompt if multiple exist.
export async function resolveAgentDir(nameOrPath?: string): Promise<string> {
  if (nameOrPath) {
    const agent = findAgent(nameOrPath);
    if (agent) return agent.path;

    const dir = resolve(nameOrPath);
    if (existsSync(dir) && (existsSync(join(dir, ".kern")) || existsSync(join(dir, "AGENTS.md")))) {
      return dir;
    }

    console.error(`Agent not found: ${nameOrPath}`);
    process.exit(1);
  }

  const paths = await loadRegistry();
  if (paths.length === 0) {
    console.error("No agents registered. Run 'kern init <name>' first.");
    process.exit(1);
  }
  if (paths.length === 1) return paths[0];

  const { select } = await import("@inquirer/prompts");
  const choices = paths.map((p) => {
    const info = readAgentInfo(p);
    return { name: info?.name || p, value: p };
  });
  return select({ message: "Select agent", choices });
}

// Try systemd first, fall back to direct daemon control.
export async function serviceOrDaemon(
  action: "start" | "stop" | "restart",
  name: string | undefined,
): Promise<void> {
  if (name) {
    const { isServiceInstalled, serviceControl } = await import("./install.js");
    if (isServiceInstalled(name)) {
      const ok = serviceControl(action, name);
      if (!ok) {
        console.error(`Failed to ${action} service-managed agent: ${name}`);
        process.exit(1);
      }
      return;
    }
  }
  const { startAgent, stopAgent } = await import("./daemon.js");
  if (action === "start") await startAgent(name);
  else if (action === "stop") await stopAgent(name);
  else {
    await stopAgent(name);
    await new Promise((r) => setTimeout(r, 500));
    await startAgent(name);
  }
}
