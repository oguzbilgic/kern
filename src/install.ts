import { execSync, spawnSync } from "child_process";
import { existsSync } from "fs";
import { mkdir, writeFile, unlink, readFile } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { loadRegistry, findAgent, isProcessRunning, setPid } from "./registry.js";

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

const SERVICE_PREFIX = "kern-agent-";
const WEB_SERVICE = "kern-web";
const SYSTEMD_DIR = join(homedir(), ".config", "systemd", "user");

// Ensure XDG_RUNTIME_DIR is set for systemctl --user to find the D-Bus socket
const uid = process.getuid?.();
if (uid !== undefined && !process.env.XDG_RUNTIME_DIR) {
  process.env.XDG_RUNTIME_DIR = `/run/user/${uid}`;
}

function hasSystemd(): boolean {
  try {
    execSync("systemctl --user --no-pager status 2>/dev/null", { stdio: "ignore" });
    return true;
  } catch {
    // systemctl exits non-zero if no services running, but that's fine
    // Check if the binary exists
    try {
      execSync("which systemctl", { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }
}

function hasLinger(): boolean {
  try {
    const user = execSync("whoami", { encoding: "utf-8" }).trim();
    const lingerDir = `/var/lib/systemd/linger`;
    return existsSync(join(lingerDir, user));
  } catch {
    return false;
  }
}

function serviceName(agentName: string): string {
  return `${SERVICE_PREFIX}${agentName}`;
}

function isInstalled(name: string): boolean {
  return existsSync(join(SYSTEMD_DIR, `${name}.service`));
}

function isActive(name: string): boolean {
  try {
    const result = spawnSync("systemctl", ["--user", "is-active", name], { encoding: "utf-8" });
    return result.stdout.trim() === "active";
  } catch {
    return false;
  }
}

export function isServiceInstalled(agentName: string): boolean {
  return isInstalled(serviceName(agentName));
}

export function serviceControl(action: "start" | "stop" | "restart", agentName: string): boolean {
  const svc = serviceName(agentName);
  return systemctl(action, svc);
}

export function getServiceStatus(agentName: string): "active" | "installed" | null {
  const svc = serviceName(agentName);
  if (!isInstalled(svc)) return null;
  return isActive(svc) ? "active" : "installed";
}

export function getWebServiceStatus(): "active" | "installed" | null {
  if (!isInstalled(WEB_SERVICE)) return null;
  return isActive(WEB_SERVICE) ? "active" : "installed";
}

function agentServiceUnit(agentName: string, agentPath: string): string {
  const kernEntry = join(import.meta.dirname, "index.js");
  const nodeBin = process.execPath;
  return `[Unit]
Description=kern agent: ${agentName}
After=network.target

[Service]
Type=simple
ExecStart=${nodeBin} --no-deprecation ${kernEntry} run ${agentPath}
Restart=always
RestartSec=5
WorkingDirectory=${agentPath}
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
`;
}

function webServiceUnit(): string {
  const webEntry = join(import.meta.dirname, "web.js");
  const nodeBin = process.execPath;
  return `[Unit]
Description=kern web UI
After=network.target

[Service]
Type=simple
ExecStart=${nodeBin} --no-deprecation ${webEntry}
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=default.target
`;
}

function systemctl(...args: string[]): boolean {
  const result = spawnSync("systemctl", ["--user", ...args], { stdio: "pipe" });
  return result.status === 0;
}

async function installAgent(agentName: string, agentPath: string): Promise<void> {
  const svc = serviceName(agentName);
  const unitPath = join(SYSTEMD_DIR, `${svc}.service`);

  // Already installed and running — skip
  if (existsSync(unitPath) && isActive(svc)) {
    console.log(`  ${green("●")} ${bold(agentName)} already installed and running`);
    return;
  }

  // Stop PID-based daemon if running (but not if it's the systemd-managed process)
  if (!existsSync(unitPath)) {
    const agent = await findAgent(agentName);
    if (agent?.pid && isProcessRunning(agent.pid)) {
      try {
        process.kill(agent.pid, "SIGTERM");
        console.log(`  ${dim("stopped pid-based daemon")} ${dim(`(pid ${agent.pid})`)}`);
        await setPid(agentName, null);
        await new Promise((r) => setTimeout(r, 1000));
      } catch {}
    }
  }

  // Write unit file
  await writeFile(unitPath, agentServiceUnit(agentName, agentPath));

  // Enable and start
  systemctl("daemon-reload");
  systemctl("enable", svc);
  systemctl("restart", svc);

  // Verify
  await new Promise((r) => setTimeout(r, 1500));
  if (isActive(svc)) {
    console.log(`  ${green("●")} ${bold(agentName)} installed and running`);
  } else {
    console.log(`  ${red("●")} ${bold(agentName)} installed but failed to start`);
    console.log(`    ${dim(`journalctl --user -u ${svc} -n 10`)}`);
  }
}

async function installWeb(): Promise<void> {
  const unitPath = join(SYSTEMD_DIR, `${WEB_SERVICE}.service`);

  // Already installed and running — skip
  if (existsSync(unitPath) && isActive(WEB_SERVICE)) {
    console.log(`  ${green("●")} ${bold("web")} already installed and running`);
    return;
  }

  // Stop existing PID-based web daemon if running
  if (!existsSync(unitPath)) {
    const pidFile = join(homedir(), ".kern", "web.pid");
    if (existsSync(pidFile)) {
      try {
        const pid = parseInt(await readFile(pidFile, "utf-8"), 10);
        if (pid && isProcessRunning(pid)) {
          process.kill(pid, "SIGTERM");
          console.log(`  ${dim("stopped pid-based web daemon")} ${dim(`(pid ${pid})`)}`);
          await new Promise((r) => setTimeout(r, 1000));
        }
        await unlink(pidFile).catch(() => {});
      } catch {}
    }
  }

  await writeFile(unitPath, webServiceUnit());

  systemctl("daemon-reload");
  systemctl("enable", WEB_SERVICE);
  systemctl("restart", WEB_SERVICE);

  await new Promise((r) => setTimeout(r, 1500));
  if (isActive(WEB_SERVICE)) {
    console.log(`  ${green("●")} ${bold("web")} installed and running`);
  } else {
    console.log(`  ${red("●")} ${bold("web")} installed but failed to start`);
    console.log(`    ${dim(`journalctl --user -u ${WEB_SERVICE} -n 10`)}`);
  }
}

export async function install(nameOrFlag?: string): Promise<void> {
  const w = (s: string) => process.stdout.write(s + "\n");

  if (!hasSystemd()) {
    console.error("systemd not available. Use 'kern start' for daemon mode instead.");
    process.exit(1);
  }

  await mkdir(SYSTEMD_DIR, { recursive: true });

  if (!hasLinger()) {
    w("");
    w(`  ${yellow("⚠")}  Linger not enabled. Services will stop when you log out.`);
    w(`     Run: ${bold("sudo loginctl enable-linger $(whoami)")}`);
    w("");
  }

  const webOnly = nameOrFlag === "--web";

  if (webOnly) {
    w("");
    await installWeb();
    w("");
    return;
  }

  const agents = nameOrFlag
    ? [await findAgent(nameOrFlag)].filter(Boolean)
    : await loadRegistry();

  if (agents.length === 0) {
    if (nameOrFlag) {
      console.error(`Agent not found: ${nameOrFlag}`);
    } else {
      console.error("No agents registered. Run 'kern init <name>' first.");
    }
    process.exit(1);
  }

  w("");
  w(`  ${bold("installing kern services")}`);
  w("");

  for (const agent of agents) {
    if (!agent) continue;
    await installAgent(agent.name, agent.path);
  }

  // Also install web if installing all
  if (!nameOrFlag) {
    await installWeb();
  }

  w("");
}

async function uninstallOne(svc: string, label: string): Promise<void> {
  const unitPath = join(SYSTEMD_DIR, `${svc}.service`);

  if (!existsSync(unitPath)) {
    console.log(`  ${dim("●")} ${bold(label)} not installed`);
    return;
  }

  systemctl("stop", svc);
  systemctl("disable", svc);
  await unlink(unitPath).catch(() => {});

  console.log(`  ${dim("●")} ${bold(label)} uninstalled`);
}

export async function uninstall(name?: string): Promise<void> {
  const w = (s: string) => process.stdout.write(s + "\n");

  if (!hasSystemd()) {
    console.error("systemd not available.");
    process.exit(1);
  }

  w("");

  if (name) {
    await uninstallOne(serviceName(name), name);
  } else {
    w(`  ${bold("uninstalling kern services")}`);
    w("");

    const agents = await loadRegistry();
    for (const agent of agents) {
      await uninstallOne(serviceName(agent.name), agent.name);
    }
    await uninstallOne(WEB_SERVICE, "web");
  }

  systemctl("daemon-reload");
  w("");
}
