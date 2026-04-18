import type { Command } from "./commands.js";
import { serviceOrDaemon } from "./helpers.js";

export const startCommand: Command = {
  async handler(args) {
    await serviceOrDaemon("start", args[0]);
  },
};
