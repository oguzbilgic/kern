import { createInterface } from "readline";
import type { StreamEvent } from "./runtime.js";
import type { ServerEvent } from "./server.js";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const blue = (s: string) => `\x1b[34m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const magenta = (s: string) => `\x1b[35m${s}\x1b[0m`;

const TOOL_COLORS: Record<string, (s: string) => string> = {
  bash: red,
  read: cyan,
  write: green,
  edit: yellow,
  glob: magenta,
  grep: blue,
  webfetch: cyan,
  kern: bold,
};

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const CLEAR_LINE = "\r\x1b[K";

class Spinner {
  private interval: ReturnType<typeof setInterval> | null = null;
  private frame = 0;
  private label = "";
  private prefix = "";

  start(label: string, prefix = "") {
    this.stop();
    this.label = label;
    this.prefix = prefix;
    this.frame = 0;
    this.interval = setInterval(() => {
      const s = SPINNER[this.frame % SPINNER.length];
      process.stdout.write(`${CLEAR_LINE}${this.prefix}${dim(`${s} ${this.label}`)}`);
      this.frame++;
    }, 80);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      process.stdout.write(CLEAR_LINE);
    }
  }
}

export async function connectTui(port: number, agentName: string): Promise<void> {
  const baseUrl = `http://127.0.0.1:${port}`;

  // Verify connection
  try {
    const res = await fetch(`${baseUrl}/status`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch {
    console.error(`Cannot connect to ${agentName} on port ${port}`);
    process.exit(1);
  }

  const w = (s: string) => process.stdout.write(s);

  w(`\n  ${bold("kern tui")} ${dim("→")} ${cyan(agentName)} ${dim(`:${port}`)}\n`);
  w(`  ${dim("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")}\n\n`);

  // Connect to SSE
  const eventSource = await fetch(`${baseUrl}/events`);
  const reader = eventSource.body!.getReader();
  const decoder = new TextDecoder();

  const spinner = new Spinner();
  let hasText = false;
  let toolCount = 0;
  let waitingForResponse = false;
  let busy = false;

  // Process SSE events in background
  (async () => {
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6);
        if (!data) continue;

        try {
          const event: ServerEvent = JSON.parse(data);

          // Cross-channel incoming message
          if ((event as any).type === "incoming") {
            spinner.stop();
            // Clear the prompt line if we're idle
            if (!busy) w(CLEAR_LINE);
            const from = event.fromInterface || "unknown";
            const user = event.fromUserId || "";
            w(`  ${dim(`[${from}${user ? ` ${user}` : ""}]`)} ${event.text}\n`);
            busy = true;
            continue;
          }

          switch (event.type) {
            case "text-delta":
              if (!hasText) {
                spinner.stop();
                if (toolCount > 0) w("\n");
                w(`${blue("◆")} `);
                hasText = true;
                busy = true;
              }
              w(event.text || "");
              break;

            case "tool-call": {
              toolCount++;
              spinner.stop();
              busy = true;
              const colorFn = TOOL_COLORS[event.toolName || ""] || yellow;
              w(`  ${colorFn(event.toolName || "tool")} ${dim(event.toolDetail || "")}\n`);
              spinner.start("thinking...");
              break;
            }

            case "finish":
              spinner.stop();
              waitingForResponse = false;
              busy = false;
              if (hasText) {
                w(`\n\n${green("> ")}`);
              } else {
                w(`\n${green("> ")}`);
              }
              hasText = false;
              toolCount = 0;
              break;

            case "error":
              spinner.stop();
              waitingForResponse = false;
              busy = false;
              w(`\n${red(event.error || "Unknown error")}\n\n${green("> ")}`);
              hasText = false;
              toolCount = 0;
              break;
          }
        } catch {
          // ignore parse errors
        }
      }
    }
  })();

  // Input loop
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  w(green("> "));

  rl.on("line", async (text) => {
    if (!text.trim()) {
      w(green("> "));
      return;
    }

    waitingForResponse = true;
    hasText = false;
    toolCount = 0;
    w("\n");
    spinner.start("thinking...", `${blue("◆")} `);

    try {
      await fetch(`${baseUrl}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text.trim(),
          userId: "tui",
          interface: "tui",
          channel: "tui",
        }),
      });
    } catch (e: any) {
      spinner.stop();
      w(`\n${red(`Connection error: ${e.message}`)}\n\n${green("> ")}`);
    }
  });

  // Clean exit
  process.on("SIGINT", () => {
    reader.cancel();
    rl.close();
    process.exit(0);
  });
}
