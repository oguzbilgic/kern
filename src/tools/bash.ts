import { tool } from "ai";
import { z } from "zod";
import { shellExec, formatShellResult } from "./shell.js";

export const bashTool = tool({
  description:
    "Run a shell command. Use this for system commands, git operations, SSH, installing packages, etc. Commands run in the agent's working directory.",
  inputSchema: z.object({
    command: z.string().describe("The shell command to execute"),
    timeout: z
      .number()
      .optional()
      .describe("Timeout in milliseconds (default: 120000)"),
  }),
  execute: async ({ command, timeout = 120000 }) => {
    const result = await shellExec(command, { timeout });
    return formatShellResult(result, timeout);
  },
});
