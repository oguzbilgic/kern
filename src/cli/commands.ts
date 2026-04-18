// Registry of kern CLI commands.
//
// Entries are data-only: help metadata plus a `load()` thunk that imports
// the command's implementation on demand. This keeps `kern --help`, `kern
// list`, and unknown-command paths from pulling in React/Ink (`tui.tsx`),
// @inquirer/prompts (`init.ts`), and other heavy deps they don't need.
//
// Each command file still exports a concrete `Command` object; the registry
// here just knows its shape and where to find it.

export interface Command {
  name: string;
  aliases?: string[];
  usage?: string;
  description: string;
  hidden?: boolean;
  handler(args: string[]): Promise<void> | void;
}

export interface CommandEntry {
  name: string;
  aliases?: string[];
  usage?: string;
  description: string;
  hidden?: boolean;
  load(): Promise<Command>;
}

export const commands: CommandEntry[] = [
  {
    name: "init",
    usage: "<name>",
    description: "create or configure an agent",
    load: async () => (await import("./init.js")).initCommand,
  },
  {
    name: "list",
    aliases: ["ls", "status"],
    description: "show all agents",
    load: async () => (await import("./status.js")).listCommand,
  },
  {
    name: "start",
    usage: "[name|path]",
    description: "start agents",
    load: async () => (await import("./start.js")).startCommand,
  },
  {
    name: "stop",
    usage: "[name]",
    description: "stop agents",
    load: async () => (await import("./stop.js")).stopCommand,
  },
  {
    name: "restart",
    usage: "[name]",
    description: "restart agents",
    load: async () => (await import("./restart.js")).restartCommand,
  },
  {
    name: "remove",
    usage: "<name>",
    aliases: ["rm"],
    description: "unregister an agent",
    load: async () => (await import("./remove.js")).removeCommand,
  },
  {
    name: "pair",
    usage: "<agent> <code>",
    description: "approve a pairing code",
    load: async () => (await import("./pair.js")).pairCommand,
  },
  {
    name: "backup",
    usage: "<name>",
    description: "backup agent to .tar.gz",
    load: async () => (await import("./backup.js")).backupCommand,
  },
  {
    name: "restore",
    usage: "<file>",
    description: "restore agent from backup",
    load: async () => (await import("./backup.js")).restoreCommand,
  },
  {
    name: "import",
    usage: "opencode <name>",
    description: "import session from OpenCode",
    load: async () => (await import("./import.js")).importCommand,
  },
  {
    name: "logs",
    usage: "[name] [-f] [-n 50] [--level warn]",
    description: "show agent logs",
    load: async () => (await import("./logs.js")).logsCommand,
  },
  {
    name: "install",
    usage: "[name|--web|--proxy]",
    description: "install systemd services",
    load: async () => (await import("./install.js")).installCommand,
  },
  {
    name: "uninstall",
    usage: "[name]",
    description: "remove systemd services",
    load: async () => (await import("./install.js")).uninstallCommand,
  },
  {
    name: "tui",
    usage: "[name]",
    description: "interactive chat",
    load: async () => (await import("./tui.js")).tuiCommand,
  },
  {
    name: "run",
    usage: "[path] [--init-if-needed]",
    description: "run an agent in the foreground (Docker, dev)",
    hidden: true,
    load: async () => (await import("./run.js")).runCommand,
  },
  {
    name: "web",
    usage: "<run|start|stop|restart|status>",
    description: "static web UI server",
    load: async () => (await import("./web.js")).webCommand,
  },
  {
    name: "proxy",
    usage: "<start|stop|restart|status|token>",
    description: "authenticated proxy server",
    load: async () => (await import("./proxy.js")).proxyCommand,
  },
];

export function findCommand(name: string): CommandEntry | undefined {
  return commands.find((c) => c.name === name || c.aliases?.includes(name));
}
