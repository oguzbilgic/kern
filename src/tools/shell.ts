import { exec, spawn } from "child_process";

export interface ShellExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
  killed: boolean;
  error?: string;
}

const MAX_OUTPUT_CHARS = 25_000;

/** Run a command via exec (buffered). Good for short commands. */
export async function shellExec(command: string, options?: { timeout?: number; maxOutput?: number }): Promise<ShellExecResult> {
  const timeout = options?.timeout ?? 120000;
  const maxOutput = options?.maxOutput ?? MAX_OUTPUT_CHARS;

  return new Promise<ShellExecResult>((resolve) => {
    exec(command, { timeout, maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
      let out = stdout || "";
      if (out.length > maxOutput) {
        out = out.slice(0, maxOutput) + `\n\n[output truncated: ${out.length} chars, showing first ${maxOutput}]`;
      }
      resolve({
        stdout: out,
        stderr: stderr || "",
        code: error?.code ?? (error ? 1 : 0),
        killed: !!error?.killed,
        error: error?.killed ? undefined : undefined,
      });
    });
  });
}

/** Run a command via spawn with explicit shell binary. For pwsh etc. */
export async function shellSpawn(command: string, shell: string, args: string[], options?: { timeout?: number; maxOutput?: number }): Promise<ShellExecResult> {
  const timeout = options?.timeout ?? 120000;
  const maxOutput = options?.maxOutput ?? MAX_OUTPUT_CHARS;

  return new Promise<ShellExecResult>((resolve) => {
    const child = spawn(shell, [...args, command], {
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

    child.stdout?.on("data", (data) => { stdout += data.toString(); });
    child.stderr?.on("data", (data) => { stderr += data.toString(); });

    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: null, killed, error: error.message });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
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
