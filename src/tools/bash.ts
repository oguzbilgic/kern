import { tool } from "ai";
import { z } from "zod";
import { exec } from "child_process";

const MAX_OUTPUT_CHARS = 25_000;

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
    return new Promise<string>((resolve) => {
      exec(command, { timeout, maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
        const parts: string[] = [];
        if (stdout) parts.push(stdout);
        if (stderr) parts.push(`stderr: ${stderr}`);
        if (error && error.killed) parts.push(`Error: command timed out after ${timeout}ms`);
        else if (error) parts.push(`Error: exit code ${error.code}`);
        let output = parts.join("\n") || "(no output)";
        if (output.length > MAX_OUTPUT_CHARS) {
          output = output.slice(0, MAX_OUTPUT_CHARS) + `\n\n[output truncated: ${output.length} chars, showing first ${MAX_OUTPUT_CHARS}]`;
        }
        resolve(output);
      });
    });
  },
});
