import { join } from "path";
import { mkdirSync, existsSync, unlinkSync, readFileSync } from "fs";
import { log } from "../../log.js";

// ---------------------------------------------------------------------------
// Job registry — lightweight in-memory map of background processes
// ---------------------------------------------------------------------------

export interface Job {
  id: string;
  pid: number;
  command: string;
  status: "running" | "done" | "failed";
  logFile: string;
  startedAt: number;
  exitCode: number | null;
}

const jobs = new Map<string, Job>();

/** Return the jobs directory for a given agent dir, creating it if needed. */
export function jobsDir(agentDir: string): string {
  const dir = join(agentDir, ".kern", "jobs");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** Register a new background job. */
export function addJob(job: Job): void {
  jobs.set(job.id, job);
}

/** Get a job by ID. */
export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

/** List all tracked jobs. */
export function listJobs(): Job[] {
  return Array.from(jobs.values());
}

/** Mark a job as complete. */
export function completeJob(id: string, exitCode: number | null): void {
  const job = jobs.get(id);
  if (!job) return;
  job.status = exitCode === 0 ? "done" : "failed";
  job.exitCode = exitCode;
}

/** Set exit code on a job without changing status (used by child close handler). */
export function setExitCode(id: string, code: number | null): void {
  const job = jobs.get(id);
  if (job) job.exitCode = code;
}

/** Remove a job from registry. */
export function removeJob(id: string): void {
  jobs.delete(id);
}

/** Read the full contents of a log file. */
export function readLogFull(logFile: string): string {
  try {
    if (!existsSync(logFile)) return "(log file not found)";
    return readFileSync(logFile, "utf-8");
  } catch {
    return "(failed to read log)";
  }
}

/** Read the tail of a job's log file. */
export function readLogTail(logFile: string, lines = 20): string {
  try {
    if (!existsSync(logFile)) return "(log file not found)";
    const content = readFileSync(logFile, "utf-8");
    const allLines = content.split("\n");
    // Remove trailing empty string from final newline
    if (allLines.length > 0 && allLines[allLines.length - 1] === "") {
      allLines.pop();
    }
    const tail = allLines.slice(-lines).join("\n");
    return tail;
  } catch {
    return "(failed to read log)";
  }
}

/** Clean up a job's log file (best-effort). */
export function cleanupLogFile(logFile: string): void {
  try {
    if (existsSync(logFile)) unlinkSync(logFile);
  } catch {
    // non-critical
  }
}

// ---------------------------------------------------------------------------
// PID reaper — interval that checks for completed background processes
// ---------------------------------------------------------------------------

type CompletionHandler = (job: Job, logTail: string) => void;

let reaperInterval: ReturnType<typeof setInterval> | null = null;

/** Check if a PID is still running via kill(pid, 0). */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Start the PID reaper. Calls `onComplete` when a background job finishes. */
export function startReaper(onComplete: CompletionHandler, intervalMs = 3000): void {
  if (reaperInterval) return; // already running

  reaperInterval = setInterval(() => {
    for (const job of jobs.values()) {
      if (job.status !== "running") continue;
      if (isRunning(job.pid)) continue;

      // Process exited — transition status and fire callback.
      // exitCode may already be set by the child "close" handler (via setExitCode),
      // or null if the process was fully detached.
      completeJob(job.id, job.exitCode);

      const tail = readLogTail(job.logFile);
      log("exec", `job ${job.id} finished (exit ${job.exitCode ?? "?"}): ${job.command.slice(0, 80)}`);
      onComplete(job, tail);
    }
  }, intervalMs);
}

/** Stop the reaper. */
export function stopReaper(): void {
  if (reaperInterval) {
    clearInterval(reaperInterval);
    reaperInterval = null;
  }
}

/** Kill all running background jobs (cleanup on shutdown). */
export function killAllJobs(): void {
  for (const job of jobs.values()) {
    if (job.status !== "running") continue;
    try {
      process.kill(job.pid, "SIGTERM");
      log("exec", `killed orphaned job ${job.id} (pid ${job.pid})`);
    } catch {
      // already dead
    }
  }
}
