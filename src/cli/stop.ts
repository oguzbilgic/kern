import type { Command } from "./commands.js";
import { serviceOrDaemon } from "./helpers.js";

export const stopCommand: Command = {
  async handler(args) {
    await serviceOrDaemon("stop", args[0]);
  },
};
