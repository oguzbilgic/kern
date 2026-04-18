// Command table for the kern CLI.
//
// Each command owns: its name (+ aliases), a one-line usage hint for help,
// a short description, and a handler that receives the argv tail (everything
// after the command name). Handlers lazy-import their deps so startup stays
// fast — `kern status` should never load the TUI bundle.

import { resolve, basename, join } from "path";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { findAgent, loadRegistry, readAgentInfo } from "../registry.js";

export type Command = {
  name: string;
  aliases?: string[];
  usage?: string;        // e.g. "<name>" — rendered after the command name in help
  description: string;   // one-line help text
  hidden?: boolean;      // skip in help output
  handler: (args: string[]) => Promise<void>;
};

// Resolve an agent directory from a name or path, or prompt if multiple exist.
async function resolveAgentDir(nameOrPath?: string): Promise<string> {
  if (nameOrPath) {
    const agent = findAgent(nameOrPath);
    if (agent) return agent.path;

    const dir = resolve(nameOrPath);
    if (existsSync(dir) && (existsSync(join(dir, ".kern")) || existsSync(join(dir, "AGENTS.md")))) {
      return dir;
    }

    console.error(`Agent not found: ${nameOrPath}`);
    process.exit(1);
  }

  const paths = await loadRegistry();
  if (paths.length === 0) {
    console.error("No agents registered. Run 'kern init <name>' first.");
    process.exit(1);
  }
  if (paths.length === 1) return paths[0];

  const { select } = await import("@inquirer/prompts");
  const choices = paths.map((p) => {
    const info = readAgentInfo(p);
    return { name: info?.name || p, value: p };
  });
  return select({ message: "Select agent", choices });
}

// Shared: try systemd first, fall back to direct daemon control.
async function serviceOrDaemon(
  action: "start" | "stop" | "restart",
  name: string | undefined,
): Promise<void> {
  if (name) {
    const { isServiceInstalled, serviceControl } = await import("./install.js");
    if (isServiceInstalled(name)) {
      const ok = serviceControl(action, name);
      if (!ok) {
        console.error(`Failed to ${action} service-managed agent: ${name}`);
        process.exit(1);
      }
      return;
    }
  }
  const { startAgent, stopAgent } = await import("./daemon.js");
  if (action === "start") await startAgent(name);
  else if (action === "stop") await stopAgent(name);
  else {
    await stopAgent(name);
    await new Promise((r) => setTimeout(r, 500));
    await startAgent(name);
  }
}

export const commands: Command[] = [
  {
    name: "init",
    usage: "<name>",
    description: "create or configure an agent",
    async handler(args) {
      // Parse --flag value pairs and a positional target
      const flags: Record<string, string> = {};
      let target = args[0];
      for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith("--") && i + 1 < args.length && !args[i + 1].startsWith("--")) {
          flags[args[i].slice(2)] = args[i + 1];
          i++;
        } else if (!args[i].startsWith("--")) {
          target = args[i];
        }
      }
      const { runInit } = await import("./init.js");
      await runInit(target, Object.keys(flags).length > 0 ? flags : undefined);
    },
  },

  {
    name: "list",
    aliases: ["ls", "status"],
    description: "show all agents",
    async handler() {
      const { showStatus } = await import("./status.js");
      await showStatus();
    },
  },

  {
    name: "start",
    usage: "[name|path]",
    description: "start agents",
    async handler(args) {
      await serviceOrDaemon("start", args[0]);
    },
  },

  {
    name: "stop",
    usage: "[name]",
    description: "stop agents",
    async handler(args) {
      await serviceOrDaemon("stop", args[0]);
    },
  },

  {
    name: "restart",
    usage: "[name]",
    description: "restart agents",
    async handler(args) {
      await serviceOrDaemon("restart", args[0]);
    },
  },

  {
    name: "remove",
    aliases: ["rm"],
    usage: "<name>",
    description: "unregister an agent",
    async handler(args) {
      const name = args[0];
      if (!name) {
        console.error("Usage: kern remove <name>");
        process.exit(1);
      }
      const { removeAgent, isProcessRunning } = await import("../registry.js");
      const agent = findAgent(name);
      if (!agent) {
        console.error(`Agent not found: ${name}`);
        process.exit(1);
      }
      const { isServiceInstalled, uninstall } = await import("./install.js");
      if (isServiceInstalled(name)) await uninstall(name);
      if (agent.pid && isProcessRunning(agent.pid)) {
        const { stopAgent } = await import("./daemon.js");
        await stopAgent(name);
      }
      await removeAgent(name);
      console.log(`  Removed ${name}`);
    },
  },

  {
    name: "pair",
    usage: "<agent> <code>",
    description: "approve a pairing code",
    async handler(args) {
      const [agentName, code] = args;
      if (!agentName || !code) {
        console.error("Usage: kern pair <agent> <code>");
        process.exit(1);
      }
      const { PairingManager } = await import("../pairing.js");
      const agent = findAgent(agentName);
      if (!agent) {
        console.error(`Agent not found: ${agentName}`);
        process.exit(1);
      }
      const pairing = new PairingManager(agent.path);
      await pairing.load();
      const result = await pairing.pair(code);
      if (result) {
        console.log(`  Paired user ${result.userId} (${result.interface}) to ${agentName}`);
      } else {
        console.error(`  Invalid or expired code: ${code}`);
        process.exit(1);
      }
    },
  },

  {
    name: "backup",
    usage: "<name>",
    description: "backup agent to .tar.gz",
    async handler(args) {
      const { backupAgent } = await import("./backup.js");
      await backupAgent(args[0]);
    },
  },

  {
    name: "restore",
    usage: "<file>",
    description: "restore agent from backup",
    async handler(args) {
      const { restoreAgent } = await import("./backup.js");
      await restoreAgent(args[0]);
    },
  },

  {
    name: "import",
    usage: "opencode <name>",
    description: "import session from OpenCode",
    async handler(args) {
      const source = args[0];
      if (source === "opencode") {
        const { importOpenCode } = await import("./import.js");
        await importOpenCode(args.slice(1));
        return;
      }
      console.error("Usage: kern import opencode [--project <path>] [--session <title|latest>] [--agent <name>]");
      process.exit(1);
    },
  },

  {
    name: "logs",
    usage: "[name] [-f] [-n 50] [--level warn]",
    description: "show agent logs",
    async handler(args) {
      let follow: boolean | null = null;
      let lines = 50;
      let level: string | null = null;
      let nameArg: string | undefined;
      for (let i = 0; i < args.length; i++) {
        if (args[i] === "-f") follow = true;
        else if (args[i] === "-n" && args[i + 1]) lines = parseInt(args[++i], 10) || 50;
        else if (args[i] === "--level" && args[i + 1]) level = args[++i];
        else if (!args[i].startsWith("-")) nameArg = args[i];
      }

      const agentDir = await resolveAgentDir(nameArg);
      const logFile = join(agentDir, ".kern", "logs", "kern.log");
      if (!existsSync(logFile)) {
        console.error("No logs yet. Start the agent first.");
        process.exit(1);
      }

      const LEVEL_FILTERS: Record<string, string[]> = {
        debug: [],
        info: [],
        warn: ["WRN", "ERR"],
        error: ["ERR"],
      };
      const filterLabels = level ? LEVEL_FILTERS[level] : null;
      // Default: follow unless -n was specified
      const shouldFollow = follow !== null ? follow : !args.some((a) => a === "-n");

      if (shouldFollow) {
        const { spawn } = await import("child_process");
        if (!filterLabels || filterLabels.length === 0) {
          const tail = spawn("tail", ["-f", "-n", String(lines), logFile], { stdio: "inherit" });
          process.on("SIGINT", () => { tail.kill(); process.exit(0); });
        } else {
          const pattern = filterLabels.join("\\|");
          const tail = spawn("sh", ["-c", `tail -f -n +1 "${logFile}" | grep --line-buffered "${pattern}"`], { stdio: "inherit" });
          process.on("SIGINT", () => { tail.kill(); process.exit(0); });
        }
      } else {
        const content = await readFile(logFile, "utf-8");
        let allLines = content.trimEnd().split("\n");
        if (filterLabels && filterLabels.length > 0) {
          allLines = allLines.filter((l) => filterLabels.some((label) => l.includes(label)));
        }
        for (const line of allLines.slice(-lines)) process.stdout.write(line + "\n");
      }
    },
  },

  {
    name: "install",
    usage: "[name|--web|--proxy]",
    description: "install systemd services",
    async handler(args) {
      const { install } = await import("./install.js");
      await install(args[0]);
    },
  },

  {
    name: "uninstall",
    usage: "[name]",
    description: "remove systemd services",
    async handler(args) {
      const { uninstall } = await import("./install.js");
      await uninstall(args[0]);
    },
  },

  {
    name: "tui",
    usage: "[name]",
    description: "interactive chat",
    async handler(args) {
      const { connectTui } = await import("./tui.js");
      const { isProcessRunning } = await import("../registry.js");

      let agentName = args[0];
      if (!agentName) {
        const paths = await loadRegistry();
        if (paths.length === 0) {
          console.error("No agents registered. Run 'kern init <name>' first.");
          process.exit(1);
        } else if (paths.length === 1) {
          const info = readAgentInfo(paths[0]);
          agentName = info?.name || paths[0];
        } else {
          const { select } = await import("@inquirer/prompts");
          const choices = paths.map((p) => {
            const info = readAgentInfo(p);
            return { name: info?.name || p, value: info?.name || p };
          });
          agentName = await select({ message: "Select agent", choices });
        }
      }

      let agent = findAgent(agentName);
      if (!agent) {
        console.error(`Agent not found: ${agentName}`);
        process.exit(1);
      }

      if (!agent.pid || !isProcessRunning(agent.pid)) {
        const { startAgent } = await import("./daemon.js");
        await startAgent(agentName);
        agent = findAgent(agentName);
      }

      if (!agent?.port) {
        console.error(`Cannot determine port for ${agentName}. Is it running?`);
        process.exit(1);
      }

      await connectTui(agent.port, agentName, agent.token || undefined);
    },
  },

  {
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
  },

  {
    name: "web",
    usage: "<run|start|stop|status>",
    description: "static web UI server",
    async handler(args) {
      const subcmd = args[0];
      if (subcmd === "start" || subcmd === "stop" || subcmd === "restart") {
        const { getWebServiceStatus } = await import("./install.js");
        if (getWebServiceStatus() !== null) {
          const { spawnSync } = await import("child_process");
          spawnSync("systemctl", ["--user", subcmd, "kern-web"], { stdio: "pipe" });
          return;
        }
        const { webStart, webStop } = await import("./web-daemon.js");
        if (subcmd === "start") await webStart();
        else if (subcmd === "stop") await webStop();
        else { await webStop(); await new Promise((r) => setTimeout(r, 500)); await webStart(); }
      } else if (subcmd === "status") {
        const { webStatus } = await import("./web-daemon.js");
        await webStatus();
      } else if (subcmd === "run") {
        // Foreground mode for Docker
        await import("../web.js");
      } else {
        console.error("Usage: kern web <run|start|stop|status>");
        process.exit(1);
      }
    },
  },

  {
    name: "proxy",
    usage: "<start|stop|status|token>",
    description: "authenticated proxy server",
    async handler(args) {
      const subcmd = args[0];
      if (subcmd === "start" || subcmd === "stop" || subcmd === "restart") {
        const { getProxyServiceStatus } = await import("./install.js");
        if (getProxyServiceStatus() !== null) {
          const { spawnSync } = await import("child_process");
          spawnSync("systemctl", ["--user", subcmd, "kern-proxy"], { stdio: "pipe" });
          return;
        }
        const { proxyStart, proxyStop } = await import("./proxy-daemon.js");
        if (subcmd === "start") await proxyStart();
        else if (subcmd === "stop") await proxyStop();
        else { await proxyStop(); await new Promise((r) => setTimeout(r, 500)); await proxyStart(); }
      } else if (subcmd === "status") {
        const { proxyStatus } = await import("./proxy-daemon.js");
        await proxyStatus();
      } else if (subcmd === "token") {
        const { proxyToken } = await import("./proxy-daemon.js");
        await proxyToken();
      } else {
        console.error("Usage: kern proxy <start|stop|status|token>");
        process.exit(1);
      }
    },
  },
];

// Lookup by name or alias.
export function findCommand(name: string): Command | undefined {
  return commands.find((c) => c.name === name || c.aliases?.includes(name));
}
