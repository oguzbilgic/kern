import type { Command } from "./commands.js";
import { serviceOrDaemon } from "./helpers.js";

export const startCommand: Command = {
  name: "start",
  usage: "[name|path]",
  description: "start agents",
  async handler(args) {
    await serviceOrDaemon("start", args[0]);
  },
};
