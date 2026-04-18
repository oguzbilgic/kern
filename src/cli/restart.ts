import type { Command } from "./commands.js";
import { serviceOrDaemon } from "./helpers.js";

export const restartCommand: Command = {
  async handler(args) {
    await serviceOrDaemon("restart", args[0]);
  },
};
