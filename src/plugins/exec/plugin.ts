import { tool } from "ai";
import { z } from "zod";
import { spawn } from "child_process";
import { randomBytes } from "crypto";
import { createWriteStream } from "fs";
import { join } from "path";
import type { KernPlugin, PluginContext } from "../types.js";
import { formatShellResult, type ShellExecResult } from "../../tools/shell.js";
import {
  addJob,
  completeJob,
  setExitCode,
  jobsDir,
  listJobs,
  readLogFull,
  readLogTail,
  cleanupLogFile,
  startReaper,
  stopReaper,
  killAllJobs,
  type Job,
} from "./jobs.js";
import { log } from "../../log.js";

const DEFAULT_YIELD_MS = 10_000;
const LOG_TAIL_LINES = 50;
const COMPLETION_TAIL_LINES = 20;
const LOG_CLEANUP_DELAY_MS = 60_000; // keep log files for 60s after completion

/**
 * Spawn a command and write stdout+stderr to log files.
 * stdout goes to `<id>.log`, stderr goes to `<id>.err.log`.
 * Returns immediately with the child process and log paths.
 */
function spawnWithLog(command: string, agentDir: string): {
  child: ReturnType<typeof spawn>;
  logFile: string;
  errLogFile: string;
  jobId: string;
} {
  const jobId = randomBytes(6).toString("hex");
  const dir = jobsDir(agentDir);
  const logFile = join(dir, `${jobId}.log`);
  const errLogFile = join(dir, `${jobId}.err.log`);
  const outStream = createWriteStream(logFile, { flags: "a" });
  const errStream = createWriteStream(errLogFile, { flags: "a" });

  const child = spawn("sh", ["-c", command], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });

  child.stdout?.on("data", (data: Buffer) => outStream.write(data));
  child.stderr?.on("data", (data: Buffer) => {
    outStream.write(data);   // combined log for `read` tool
    errStream.write(data);   // separate stderr for error detection
  });
  child.on("close", () => { outStream.end(); errStream.end(); });
  child.on("error", (err) => {
    outStream.write(`\n[spawn error: ${err.message}]\n`);
    outStream.end();
    errStream.end();
  });

  return { child, logFile, errLogFile, jobId };
}

function createBashTool(agentDir: string) {
  return tool({
    description:
      "Run a shell command. Use this for system commands, git operations, SSH, installing packages, etc. " +
      "Commands run in the agent's working directory. " +
      "Fast commands return output directly. " +
      "Slow commands auto-background after `yieldMs` milliseconds and return a job with `logFile` — use the `read` tool to check progress. " +
      "Set `background: true` to immediately run in background.",
    inputSchema: z.object({
      command: z.string().describe("The shell command to execute"),
      timeout: z
        .number()
        .optional()
        .describe("Timeout in milliseconds (default: 120000). Only applies to foreground (non-backgrounded) commands."),
      background: z
        .boolean()
        .optional()
        .describe("If true, run command in background immediately and return job info"),
      yieldMs: z
        .number()
        .optional()
        .describe(
          "Auto-background timeout in milliseconds (default: 10000). " +
          "If the command hasn't finished within this time, it is backgrounded and job info is returned."
        ),
    }),
    execute: async ({ command, timeout = 120000, background = false, yieldMs = DEFAULT_YIELD_MS }) => {
      const { child, logFile, errLogFile, jobId } = spawnWithLog(command, agentDir);
      const pid = child.pid;
      if (!pid) {
        cleanupLogFile(logFile);
        cleanupLogFile(errLogFile);
        return "Error: failed to spawn process";
      }

      // Register job
      const job: Job = {
        id: jobId,
        pid,
        command,
        status: "running",
        logFile,
        startedAt: Date.now(),
        exitCode: null,
      };
      addJob(job);

      // Track exit code — for background jobs, the reaper handles status transition.
      // For foreground jobs that finish within yieldMs, completeJob is called below.
      child.on("close", (code) => {
        setExitCode(jobId, code);
      });
      child.on("error", () => {
        setExitCode(jobId, 1);
      });

      // Immediate background mode
      if (background) {
        child.unref();
        // Small delay to let initial output arrive
        await new Promise((r) => setTimeout(r, 100));
        const tail = readLogTail(logFile, LOG_TAIL_LINES);
        return JSON.stringify({
          status: "background",
          jobId,
          pid,
          logFile,
          output: tail || "(no output yet)",
        });
      }

      // Wait up to yieldMs for the command to finish
      const effectiveYield = Math.min(yieldMs, timeout);

      const result = await new Promise<{ finished: boolean; code: number | null }>((resolve) => {
        let done = false;

        const yieldTimer = setTimeout(() => {
          if (!done) {
            done = true;
            resolve({ finished: false, code: null });
          }
        }, effectiveYield);

        child.on("close", (code) => {
          if (!done) {
            done = true;
            clearTimeout(yieldTimer);
            resolve({ finished: true, code });
          }
        });

        child.on("error", () => {
          if (!done) {
            done = true;
            clearTimeout(yieldTimer);
            resolve({ finished: true, code: 1 });
          }
        });
      });

      if (result.finished) {
        // Fast path — command finished within yieldMs
        completeJob(jobId, result.code);

        // Read full output and stderr directly
        let stdout = readLogFull(logFile);
        const stderr = readLogFull(errLogFile);

        // Clean up log files immediately for fast path (no need to keep around)
        cleanupLogFile(logFile);
        cleanupLogFile(errLogFile);

        // Truncate to max output chars for consistency
        if (stdout.length > 25_000) {
          const originalLen = stdout.length;
          stdout = stdout.slice(0, 25_000) +
            `\n\n[output truncated: ${originalLen} chars, showing first 25000]`;
        }

        // Format like the original bash tool for backward compatibility
        const shellResult: ShellExecResult = {
          stdout,
          stderr,
          code: result.code,
          killed: false,
        };
        return formatShellResult(shellResult, timeout);
      }

      // Slow path — auto-background
      child.unref();
      const tail = readLogTail(logFile, LOG_TAIL_LINES);
      log("exec", `auto-backgrounded job ${jobId} (pid ${pid}): ${command.slice(0, 80)}`);

      return JSON.stringify({
        status: "background",
        jobId,
        pid,
        logFile,
        output: tail || "(no output yet)",
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

export const execPlugin: KernPlugin = {
  name: "exec",

  // Tools and toolDescriptions are set dynamically at startup
  tools: {},
  toolDescriptions: {},

  async onStartup(ctx: PluginContext) {
    // Create the bash tool bound to this agent's directory
    const bashTool = createBashTool(ctx.agentDir);
    execPlugin.tools = { bash: bashTool };
    execPlugin.toolDescriptions = {
      bash: "run shell commands (supports background execution)",
    };

    // Start PID reaper — on completion, enqueue a system message for the agent.
    // Log files are kept around so the agent can `read` them after getting the
    // completion event. They are cleaned up on the next reaper cycle after
    // the job has been in a terminal state for at least LOG_CLEANUP_DELAY_MS.
    startReaper((job: Job, logTail: string) => {
      const msg = [
        `[process] Job ${job.id} finished (exit ${job.exitCode ?? "?"}): ${job.command}`,
        `Last ${COMPLETION_TAIL_LINES} lines:`,
        logTail,
      ].join("\n");

      if (ctx.enqueueMessage) {
        ctx.enqueueMessage(msg);
      }

      // Schedule deferred log file cleanup
      setTimeout(() => {
        cleanupLogFile(job.logFile);
        // Also clean up the stderr log
        cleanupLogFile(job.logFile.replace(/\.log$/, ".err.log"));
      }, LOG_CLEANUP_DELAY_MS);
    });

    log("exec", "plugin started — PID reaper active");
  },

  async onShutdown(_ctx: PluginContext) {
    stopReaper();
    killAllJobs();
    log("exec", "plugin stopped — killed orphaned jobs");
  },

  onStatus(_ctx: PluginContext) {
    const allJobs = listJobs();
    const running = allJobs.filter((j) => j.status === "running");
    return {
      backgroundJobs: running.length,
      totalJobs: allJobs.length,
    };
  },
};
