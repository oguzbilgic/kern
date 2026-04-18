import type { Command } from "./commands.js";
import { findAgent } from "../registry.js";

export const pairCommand: Command = {
  name: "pair",
  usage: "<agent> <code>",
  description: "approve a pairing code",
  async handler(args) {
    const [agentName, code] = args;
    if (!agentName || !code) {
      console.error("Usage: kern pair <agent> <code>");
      process.exit(1);
    }
    const { PairingManager } = await import("../pairing.js");
    const agent = findAgent(agentName);
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
      process.exit(1);
    }
  },
};
