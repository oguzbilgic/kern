import type { Command } from "./commands.js";
import { serviceOrDaemon } from "./helpers.js";

export const stopCommand: Command = {
  name: "stop",
  usage: "[name]",
  description: "stop agents",
  async handler(args) {
    await serviceOrDaemon("stop", args[0]);
  },
};
