import { loadRegistry, isProcessRunning } from "./registry.js";
import { existsSync } from "fs";
import { readFile, readdir } from "fs/promises";
import { join } from "path";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

export async function showStatus(): Promise<void> {
  const agents = await loadRegistry();
  const w = (s: string) => process.stdout.write(s + "\n");

  w("");
  w(`  ${bold("kern agents")}`);
  w("");

  if (agents.length === 0) {
    w(`  ${dim("No agents registered. Run")} kern init <name> ${dim("to create one.")}`);
    w("");
    return;
  }

  for (const agent of agents) {
    const exists = existsSync(agent.path);
    const running = agent.pid ? isProcessRunning(agent.pid) : false;
    const hasConfig = exists && existsSync(join(agent.path, ".kern", "config.json"));

    // Read config
    let model = "";
    let provider = "";
    let toolScope = "";
    if (hasConfig) {
      try {
        const config = JSON.parse(await readFile(join(agent.path, ".kern", "config.json"), "utf-8"));
        model = config.model || "";
        provider = config.provider || "";
        toolScope = config.toolScope || "";
      } catch {}
    }

    // Check sessions
    let sessionInfo = "no session";
    const sessDir = join(agent.path, ".kern", "sessions");
    if (existsSync(sessDir)) {
      try {
        const files = await readdir(sessDir);
        const jsonl = files.filter((f) => f.endsWith(".jsonl"));
        if (jsonl.length > 0) {
          sessionInfo = `${jsonl.length} session${jsonl.length > 1 ? "s" : ""}`;
        }
      } catch {}
    }

    const dot = !exists ? red("●") : running ? green("●") : dim("●");
    const nameStr = bold(agent.name);
    const modelStr = provider && model ? dim(`${provider}/${model}`) : dim("no config");
    const statusStr = !exists
      ? red("not found")
      : running
        ? green(`running`) + dim(` (pid ${agent.pid})`)
        : dim("stopped");

    w(`  ${dot} ${nameStr}  ${modelStr}  ${statusStr}`);
    w(`    ${dim("path")}  ${agent.path}`);
    w(`    ${dim("tools")} ${toolScope || "—"}  ${dim("sessions")} ${sessionInfo}`);
    w("");
  }
}
