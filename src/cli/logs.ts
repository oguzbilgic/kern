import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import type { Command } from "./commands.js";
import { resolveAgentDir } from "./helpers.js";

// Level → label set. `info`/`debug` show everything (info has no label).
const LEVEL_FILTERS: Record<string, string[]> = {
  debug: [],
  info: [],
  warn: ["WRN", "ERR"],
  error: ["ERR"],
};

export const logsCommand: Command = {
  name: "logs",
  usage: "[name] [-f] [-n 50] [--level warn]",
  description: "show agent logs",
  async handler(args) {
    let follow: boolean | null = null; // null = auto (follow unless -n)
    let lines = 50;
    let level: string | null = null;
    let nameArg: string | undefined;

    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === "-f" || a === "--follow") follow = true;
      else if (a === "-n" && args[i + 1]) lines = parseInt(args[++i], 10) || 50;
      else if (a === "--level" && args[i + 1]) level = args[++i];
      else if (!a.startsWith("-")) nameArg = a;
    }

    const agentDir = await resolveAgentDir(nameArg);
    const logFile = join(agentDir, ".kern", "logs", "kern.log");
    if (!existsSync(logFile)) {
      console.error("No logs yet. Start the agent first.");
      process.exit(1);
    }

    const filterLabels = level ? LEVEL_FILTERS[level] : null;
    // Default: follow unless -n was specified.
    const shouldFollow = follow !== null ? follow : !args.some((a) => a === "-n");

    if (shouldFollow) {
      const { spawn } = await import("child_process");
      const proc = !filterLabels || filterLabels.length === 0
        ? spawn("tail", ["-f", "-n", String(lines), logFile], { stdio: "inherit" })
        : spawn(
            "sh",
            ["-c", `tail -f -n +1 "${logFile}" | grep --line-buffered "${filterLabels.join("\\|")}"`],
            { stdio: "inherit" },
          );
      process.on("SIGINT", () => { proc.kill(); process.exit(0); });
      return;
    }

    // One-shot: read last N (post-filter) lines.
    const content = await readFile(logFile, "utf-8");
    let all = content.trimEnd().split("\n");
    if (filterLabels && filterLabels.length > 0) {
      all = all.filter((l) => filterLabels.some((label) => l.includes(label)));
    }
    for (const line of all.slice(-lines)) process.stdout.write(line + "\n");
  },
};
