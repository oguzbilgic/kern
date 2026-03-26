import { spawn, type ChildProcess } from "child_process";
import { basename, join } from "path";
import { existsSync } from "fs";
import { mkdir } from "fs/promises";
import { openSync } from "fs";
import { loadRegistry, registerAgent, setPid, setPort, isProcessRunning, type AgentEntry } from "./registry.js";
import { log } from "./log.js";

interface SupervisedAgent {
  name: string;
  path: string;
  process: ChildProcess | null;
  restarts: number;
  lastStart: number;
  stopping: boolean;
}

const MAX_RESTARTS = 10;
const RESTART_WINDOW_MS = 60_000; // reset restart count after 1 min of stability
const RESTART_DELAY_MS = 2_000;

export class Supervisor {
  private agents: Map<string, SupervisedAgent> = new Map();
  private shuttingDown = false;

  async start(nameOrPath?: string): Promise<void> {
    log("supervisor", "starting in foreground mode");

    // Determine which agents to supervise
    let entries: AgentEntry[];
    if (nameOrPath) {
      // Single agent or path
      const { findAgent } = await import("./registry.js");
      let agent = await findAgent(nameOrPath);
      if (!agent) {
        const { resolve } = await import("path");
        const dir = resolve(nameOrPath);
        if (existsSync(dir) && (existsSync(join(dir, ".kern")) || existsSync(join(dir, "AGENTS.md")))) {
          const name = basename(dir);
          await registerAgent(name, dir);
          agent = { name, path: dir, pid: null, addedAt: new Date().toISOString() };
        }
      }
      if (!agent) {
        console.error(`Agent not found: ${nameOrPath}`);
        process.exit(1);
      }
      entries = [agent];
    } else {
      entries = await loadRegistry();
      if (entries.length === 0) {
        console.error("No agents registered. Run 'kern init <name>' first.");
        process.exit(1);
      }
    }

    // Set up signal handlers
    const shutdown = () => this.shutdown();
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);

    // On Windows, handle the console close event
    if (process.platform === "win32") {
      process.on("SIGHUP", shutdown);
    }

    // Stop any already-running instances of these agents
    for (const entry of entries) {
      if (entry.pid && isProcessRunning(entry.pid)) {
        log("supervisor", `stopping existing ${entry.name} (pid ${entry.pid})`);
        try {
          process.kill(entry.pid, "SIGTERM");
        } catch {}
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    // Start all agents
    console.log("");
    log("supervisor", `supervising ${entries.length} agent(s)`);
    console.log("");

    for (const entry of entries) {
      await this.startAgent(entry.name, entry.path);
    }

    log("supervisor", "all agents started, monitoring...");

    // Keep the process alive — check health periodically
    const healthCheck = setInterval(() => {
      if (this.shuttingDown) return;
      for (const [name, agent] of this.agents) {
        if (agent.stopping) continue;
        if (!agent.process || agent.process.exitCode !== null) {
          log("supervisor", `${name} is not running, will be restarted by exit handler`);
        }
      }
    }, 30_000);

    // Wait forever (until signal)
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (this.shuttingDown && this.agents.size === 0) {
          clearInterval(check);
          clearInterval(healthCheck);
          resolve();
        }
        // Also resolve if all agents have been stopped and we're shutting down
        if (this.shuttingDown) {
          let allStopped = true;
          for (const [, agent] of this.agents) {
            if (agent.process && agent.process.exitCode === null) {
              allStopped = false;
              break;
            }
          }
          if (allStopped) {
            clearInterval(check);
            clearInterval(healthCheck);
            resolve();
          }
        }
      }, 500);
    });

    log("supervisor", "all agents stopped, exiting");
  }

  private async startAgent(name: string, path: string): Promise<void> {
    if (this.shuttingDown) return;

    if (!existsSync(path)) {
      log("supervisor", `${name}: path not found: ${path}`);
      return;
    }

    // Ensure log directory
    const logDir = join(path, ".kern", "logs");
    await mkdir(logDir, { recursive: true });
    const logFile = join(logDir, "kern.log");
    const logFd = openSync(logFile, "a");

    const kernBin = join(import.meta.dirname, "index.js");

    const child = spawn("node", ["--no-deprecation", kernBin, "run", path], {
      stdio: ["ignore", logFd, logFd],
      cwd: path,
    });

    const pid = child.pid!;
    await registerAgent(name, path);
    await setPid(name, pid);

    const supervised: SupervisedAgent = {
      name,
      path,
      process: child,
      restarts: 0,
      lastStart: Date.now(),
      stopping: false,
    };

    this.agents.set(name, supervised);
    log("supervisor", `${name} started (pid ${pid})`);

    // Handle exit — restart unless we're shutting down
    child.on("exit", async (code, signal) => {
      log("supervisor", `${name} exited (code: ${code}, signal: ${signal})`);
      await setPid(name, null);
      await setPort(name, null);

      if (this.shuttingDown || supervised.stopping) {
        return;
      }

      // Reset restart count if agent was stable
      if (Date.now() - supervised.lastStart > RESTART_WINDOW_MS) {
        supervised.restarts = 0;
      }

      supervised.restarts++;

      if (supervised.restarts > MAX_RESTARTS) {
        log("supervisor", `${name} exceeded max restarts (${MAX_RESTARTS}), giving up`);
        return;
      }

      log("supervisor", `${name} restarting in ${RESTART_DELAY_MS}ms (restart ${supervised.restarts}/${MAX_RESTARTS})`);
      await new Promise((r) => setTimeout(r, RESTART_DELAY_MS));

      if (!this.shuttingDown) {
        await this.startAgent(name, path);
      }
    });
  }

  private async shutdown(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    log("supervisor", "shutting down all agents...");

    const stopPromises: Promise<void>[] = [];

    for (const [name, agent] of this.agents) {
      agent.stopping = true;
      if (agent.process && agent.process.exitCode === null) {
        stopPromises.push(
          new Promise<void>((resolve) => {
            const pid = agent.process!.pid;
            log("supervisor", `stopping ${name} (pid ${pid})`);

            // Give agent time to clean up
            const forceKillTimer = setTimeout(() => {
              log("supervisor", `${name} did not exit gracefully, force killing`);
              try {
                agent.process!.kill("SIGKILL");
              } catch {}
              resolve();
            }, 10_000);

            agent.process!.on("exit", () => {
              clearTimeout(forceKillTimer);
              log("supervisor", `${name} stopped`);
              resolve();
            });

            try {
              agent.process!.kill("SIGTERM");
            } catch {
              clearTimeout(forceKillTimer);
              resolve();
            }
          }),
        );
      }
    }

    await Promise.all(stopPromises);

    // Clean up registry
    for (const [name] of this.agents) {
      await setPid(name, null);
      await setPort(name, null);
    }
  }
}
