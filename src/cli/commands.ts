// Registry of kern CLI commands.
//
// Each command lives in its own file under src/cli/. Logic modules that
// predate the command system (init, backup, install, tui, import, status)
// export both their functions and their Command object from the same file.
// New commands (start, stop, restart, remove, pair, logs, run, web, proxy)
// are small files whose entire job is to wrap the relevant logic.

export interface Command {
  name: string;
  aliases?: string[];
  usage?: string;
  description: string;
  hidden?: boolean;
  handler(args: string[]): Promise<void> | void;
}

import { initCommand } from "./init.js";
import { listCommand } from "./status.js";
import { startCommand } from "./start.js";
import { stopCommand } from "./stop.js";
import { restartCommand } from "./restart.js";
import { removeCommand } from "./remove.js";
import { pairCommand } from "./pair.js";
import { backupCommand, restoreCommand } from "./backup.js";
import { importCommand } from "./import.js";
import { logsCommand } from "./logs.js";
import { installCommand, uninstallCommand } from "./install.js";
import { tuiCommand } from "./tui.js";
import { runCommand } from "./run.js";
import { webCommand } from "./web.js";
import { proxyCommand } from "./proxy.js";

export const commands: Command[] = [
  initCommand,
  listCommand,
  startCommand,
  stopCommand,
  restartCommand,
  removeCommand,
  pairCommand,
  backupCommand,
  restoreCommand,
  importCommand,
  logsCommand,
  installCommand,
  uninstallCommand,
  tuiCommand,
  runCommand,
  webCommand,
  proxyCommand,
];

export function findCommand(name: string): Command | undefined {
  return commands.find((c) => c.name === name || c.aliases?.includes(name));
}
