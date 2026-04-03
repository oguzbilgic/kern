import { tool } from "ai";
import { z } from "zod";
import { execFileSync } from "child_process";
import { shellSpawn, formatShellResult } from "./shell.js";

// Lazy detection: try pwsh (PS 7+), fall back to powershell (5.1)
let cachedPwshBin: string | null = null;

function pwshBin(): string {
  if (cachedPwshBin) return cachedPwshBin;

  try {
    execFileSync("pwsh", ["-Version"], { stdio: "ignore", windowsHide: true });
    cachedPwshBin = "pwsh";
  } catch {
    cachedPwshBin = "powershell";
  }

  return cachedPwshBin;
}

export const pwshTool = tool({
  description:
    "Run a PowerShell command. Use this on Windows for system commands, file operations, registry, services, etc.",
  inputSchema: z.object({
    command: z.string().describe("The PowerShell command to execute"),
    timeout: z
      .number()
      .optional()
      .describe("Timeout in milliseconds (default: 120000)"),
  }),
  execute: async ({ command, timeout = 120000 }) => {
    const result = await shellSpawn(command, pwshBin(), ["-NoProfile", "-NonInteractive", "-Command"], { timeout });
    return formatShellResult(result, timeout);
  },
});
