import { spawn } from "child_process";

export interface ShellExecOptions {
  shell: string;           // e.g. "/bin/sh", "pwsh", "bash"
  args: string[];          // e.g. ["-c"], ["-NoProfile", "-NonInteractive", "-Command"]
  timeout?: number;        // default 120000
  maxOutput?: number;      // default 25000
}

export interface ShellExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
  killed: boolean;
  error?: string;          // spawn error message
}

const MAX_OUTPUT_CHARS = 25_000;

export async function shellExec(command: string, opts: ShellExecOptions): Promise<ShellExecResult> {
  const timeout = opts.timeout ?? 120000;
  const maxOutput = opts.maxOutput ?? MAX_OUTPUT_CHARS;

  return new Promise<ShellExecResult>((resolve) => {
    const child = spawn(opts.shell, [...opts.args, command], {
      stdio: ["ignore", "pipe", "pipe"],
      ...(process.platform === "win32" ? { windowsHide: true } : {}),
    });

    let stdout = "";
    let stderr = "";
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill();
    }, timeout);

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: null, killed, error: error.message });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      // Truncate at the source to prevent massive outputs
      if (stdout.length > maxOutput) {
        stdout = stdout.slice(0, maxOutput) + `\n\n[output truncated: ${stdout.length} chars, showing first ${maxOutput}]`;
      }
      resolve({ stdout, stderr, code, killed });
    });
  });
}

/** Format a ShellExecResult into a single string for tool output */
export function formatShellResult(result: ShellExecResult, timeout?: number): string {
  const parts: string[] = [];
  if (result.stdout) parts.push(result.stdout);
  if (result.stderr) parts.push(`stderr: ${result.stderr}`);
  if (result.error) parts.push(`Error: spawn failed: ${result.error}`);
  else if (result.killed) parts.push(`Error: command timed out after ${timeout ?? 120000}ms`);
  else if (result.code !== 0) parts.push(`Error: exit code ${result.code}`);
  return parts.join("\n") || "(no output)";
}
