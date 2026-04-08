import { loadRegistry, isProcessRunning } from "./registry.js";
import { getServiceStatus, getWebServiceStatus } from "./install.js";
import { loadGlobalConfig } from "./global-config.js";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";

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

  let hasUninstalled = false;
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


    const installStatus = getServiceStatus(agent.name);
    const active = installStatus === "active" || running;
    const dot = !exists ? red("●") : active ? green("●") : dim("●");
    const nameStr = bold(agent.name);
    const modelStr = provider && model ? dim(`${provider}/${model}`) : dim("no config");
    const portStr = agent.port ? `:${agent.port}` : "";
    const pidStr = agent.pid && (running || installStatus === "active") ? `pid ${agent.pid}` : "";
    const details = [pidStr, portStr].filter(Boolean).join(", ");
    const statusStr = !exists
      ? red("not found")
      : active
        ? green("running") + (details ? dim(` (${details})`) : "")
        : dim("stopped");
    const mode = installStatus ? "systemd" : running ? "daemon" : "—";
    if (!installStatus) hasUninstalled = true;

    w(`  ${dot} ${nameStr}  ${modelStr}  ${statusStr}`);
    w(`    ${dim("path:")}  ${agent.path}`);
    w(`    ${dim("tools:")} ${toolScope || "—"}  ${dim("mode:")} ${mode}`);
    w("");
  }

  // Web status — check PID first (reliable), systemd as supplementary
  const config = await loadGlobalConfig();
  const webInstall = getWebServiceStatus();
  const pidFile = join(homedir(), ".kern", "web.pid");
  let webPid: number | null = null;
  let webRunning = false;
  if (existsSync(pidFile)) {
    try {
      webPid = parseInt(await readFile(pidFile, "utf-8"), 10);
      webRunning = !!webPid && isProcessRunning(webPid);
    } catch {}
  }
  if (!webRunning) webRunning = webInstall === "active";
  const webDot = webRunning ? green("●") : dim("●");
  const webStatus = webRunning
    ? green("running") + dim(` (:${config.web_port})`)
    : dim("stopped");
  const webMode = webInstall ? "systemd" : webRunning ? "daemon" : "—";

  w(`  ${bold("kern web")}`);
  w("");
  w(`  ${webDot} ${bold("web")}  ${webStatus}`);
  w(`    ${dim("mode:")} ${webMode}`);
  w("");

  if (hasUninstalled) {
    try {
      const { execSync } = await import("child_process");
      execSync("which systemctl", { stdio: "ignore" });
      w(`  ${dim("tip: 'kern install' enables auto-restart and boot persistence")}`);
      w("");
    } catch {}
  }
}
