import type { Command } from "./commands.js";
import { resolve, join, basename } from "path";
import { existsSync } from "fs";
import { resolveAgentDir } from "./helpers.js";

export const runCommand: Command = {
  name: "run",
  usage: "[path] [--init-if-needed]",
  description: "run an agent in the foreground (Docker, dev)",
  hidden: true,
  async handler(args) {
    const initIfNeeded = args.includes("--init-if-needed");
    const dirArg = args.filter((a) => a !== "--init-if-needed")[0];
    const agentDir = initIfNeeded ? resolve(dirArg || ".") : await resolveAgentDir(dirArg);

    if (initIfNeeded && !existsSync(join(agentDir, ".kern", "config.json"))) {
      const { scaffoldAgent, API_KEY_ENV } = await import("./init.js");
      const name = process.env.KERN_NAME || basename(agentDir);
      const provider = process.env.KERN_PROVIDER || "openrouter";
      const envVar = API_KEY_ENV[provider] || "OPENROUTER_API_KEY";
      await scaffoldAgent({
        name, dir: agentDir, provider, envVar, skipStart: true,
        model: process.env.KERN_MODEL || "anthropic/claude-opus-4.7",
        apiKey: process.env[envVar] || "",
        telegramToken: process.env.TELEGRAM_BOT_TOKEN || "",
        slackBotToken: process.env.SLACK_BOT_TOKEN || "",
        slackAppToken: process.env.SLACK_APP_TOKEN || "",
      });
    }

    const { startApp } = await import("../app.js");
    await startApp(agentDir);
  },
};
