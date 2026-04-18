import type { Command } from "./commands.js";
import { findAgent } from "../registry.js";

export const removeCommand: Command = {
  async handler(args) {
    const name = args[0];
    if (!name) {
      console.error("Usage: kern remove <name>");
      process.exit(1);
    }
    const { removeAgent, isProcessRunning } = await import("../registry.js");
    const agent = findAgent(name);
    if (!agent) {
      console.error(`Agent not found: ${name}`);
      process.exit(1);
    }
    const { isServiceInstalled, uninstall } = await import("./install.js");
    if (isServiceInstalled(name)) await uninstall(name);
    if (agent.pid && isProcessRunning(agent.pid)) {
      const { stopAgent } = await import("./daemon.js");
      await stopAgent(name);
    }
    await removeAgent(name);
    console.log(`  Removed ${name}`);
  },
};
