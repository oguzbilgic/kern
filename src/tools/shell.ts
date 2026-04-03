import { spawn } from "child_process";

export interface ShellExecOptions {
  shell: string;           // e.g. "/bin/sh", "pwsh", "bash"
  args: string[];          // e.g. ["-c"], ["-NoProfile", "-NonInteractive", "-Command"]
  timeout?: number;        // default 120000
  maxOutput?: number;      // default 25000
}

export async function shellExec(command: string, opts: ShellExecOptions): Promise<string> {
  const timeout = opts.timeout ?? 120000;
  const maxOutput = opts.maxOutput ?? 25000;

  return new Promise<string>((resolve) => {
    const child = spawn(opts.shell, [...opts.args, command], {
      stdio: ["ignore", "pipe", "pipe"],
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
      const parts: string[] = [];
      if (stdout) parts.push(stdout);
      if (stderr) parts.push(`stderr: ${stderr}`);
      parts.push(`Error: spawn failed: ${error.message}`);
      let output = parts.join("\n");
      if (output.length > maxOutput) {
        output = output.slice(0, maxOutput) + `\n\n[output truncated: ${output.length} chars, showing first ${maxOutput}]`;
      }
      resolve(output);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const parts: string[] = [];
      if (stdout) parts.push(stdout);
      if (stderr) parts.push(`stderr: ${stderr}`);
      if (killed) parts.push(`Error: command timed out after ${timeout}ms`);
      else if (code !== 0) parts.push(`Error: exit code ${code}`);
      let output = parts.join("\n") || "(no output)";
      if (output.length > maxOutput) {
        output = output.slice(0, maxOutput) + `\n\n[output truncated: ${output.length} chars, showing first ${maxOutput}]`;
      }
      resolve(output);
    });
  });
}
