#!/usr/bin/env -S node --no-deprecation

// kern CLI entrypoint.
//
// This is intentionally thin: parse argv, look up the command in the table
// declared in src/cli/commands.ts, run its handler. Help text is generated
// from the same table, so it can't drift.

import { readFile } from "fs/promises";
import { join } from "path";
import { commands, findCommand } from "./cli/commands.js";

const args = process.argv.slice(2);
const cmd = args[0];

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

async function showHelp() {
  let version = "unknown";
  try {
    const pkg = JSON.parse(await readFile(join(import.meta.dirname, "..", "package.json"), "utf-8"));
    version = pkg.version;
  } catch {}

  const w = (s: string) => process.stdout.write(s + "\n");
  w("");
  w(`  ${bold("kern")} ${dim("v" + version)}`);
  w(`  ${dim("One agent. One folder. One continuous conversation.")}`);
  w("");
  w(`  ${yellow("Commands")}`);

  // Compute padding so the descriptions line up.
  const visible = commands.filter((c) => !c.hidden);
  const left = visible.map((c) => `kern ${c.name}${c.usage ? " " + c.usage : ""}`);
  const maxWidth = Math.max(...left.map((s) => s.length));

  visible.forEach((c, i) => {
    const name = cyan("kern " + c.name);
    const usage = c.usage ? " " + dim(c.usage) : "";
    // Pad based on uncolored length so alignment is correct.
    const pad = " ".repeat(Math.max(2, maxWidth - left[i].length + 2));
    w(`    ${name}${usage}${pad}${c.description}`);
  });
  w("");
}

async function main() {
  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    await showHelp();
    process.exit(0);
  }

  const command = findCommand(cmd);
  if (!command) {
    console.error(`Unknown command: ${cmd}`);
    await showHelp();
    process.exit(1);
  }

  const impl = await command.load();
  await impl.handler(args.slice(1));
  // Don't force exit: long-running commands (for example, logs -f and
  // web run) keep handles open and need Node to stay alive until they
  // close. Short commands have no open handles and exit naturally.
}

main().catch((error) => {
  console.error("Fatal:", error.message);
  process.exit(1);
});
