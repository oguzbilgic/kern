import type { Command } from "./commands.js";
import { resolveAgentDir } from "./helpers.js";

const LEVELS = ["debug", "info", "warn", "error"];

export const logsCommand: Command = {
  name: "logs",
  usage: "[name] [-f] [-n 50] [--level warn]",
  description: "show agent logs",
  async handler(args) {
    let agentName: string | undefined;
    let follow = false;
    let lines = 50;
    let minLevel = "info";

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === "-f" || arg === "--follow") {
        follow = true;
      } else if (arg === "-n" && i + 1 < args.length) {
        lines = parseInt(args[++i], 10) || 50;
      } else if (arg === "--level" && i + 1 < args.length) {
        minLevel = args[++i];
      } else if (!arg.startsWith("-")) {
        agentName = arg;
      }
    }

    if (!LEVELS.includes(minLevel)) {
      console.error(`Invalid level: ${minLevel}. Use: debug, info, warn, error`);
      process.exit(1);
    }

    const agentPath = await resolveAgentDir(agentName);
    const { join } = await import("path");
    const { existsSync, createReadStream } = await import("fs");
    const { createInterface } = await import("readline");
    const logPath = join(agentPath, ".kern", "log.jsonl");

    if (!existsSync(logPath)) {
      console.error(`No logs yet: ${logPath}`);
      process.exit(1);
    }

    const minIdx = LEVELS.indexOf(minLevel);
    const formatLine = (line: string) => {
      try {
        const entry = JSON.parse(line);
        if (LEVELS.indexOf(entry.level) < minIdx) return null;
        const ts = entry.ts || new Date().toISOString();
        const level = (entry.level || "info").toUpperCase().padEnd(5);
        return `\x1b[2m${ts}\x1b[0m ${level} ${entry.msg || ""}`;
      } catch {
        return null;
      }
    };

    const { execSync, spawn } = await import("child_process");
    const tailArgs = ["-n", String(lines)];
    if (follow) tailArgs.push("-f");
    tailArgs.push(logPath);

    const child = spawn("tail", tailArgs, { stdio: ["ignore", "pipe", "inherit"] });
    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    rl.on("line", (line) => {
      const out = formatLine(line);
      if (out) console.log(out);
    });
    await new Promise<void>((resolve) => child.on("close", () => resolve()));
  },
};
