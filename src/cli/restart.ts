import type { Command } from "./commands.js";
import { serviceOrDaemon } from "./helpers.js";

export const restartCommand: Command = {
  name: "restart",
  usage: "[name]",
  description: "restart agents",
  async handler(args) {
    await serviceOrDaemon("restart", args[0]);
  },
};
