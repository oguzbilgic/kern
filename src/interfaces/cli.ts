import { createInterface } from "readline";
import type { Interface, StartOptions } from "./types.js";
import type { StreamEvent } from "../runtime.js";

// ANSI
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

export class CliInterface implements Interface {
  private rl: ReturnType<typeof createInterface> | null = null;

  async start({ onMessage, history }: StartOptions): Promise<void> {
    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    // Show recent history (last 2 exchanges)
    if (history && history.length > 0) {
      const recent = history.slice(-4);
      for (const msg of recent) {
        if (msg.role === "user" && typeof msg.content === "string") {
          const preview = msg.content.length > 80 ? msg.content.slice(0, 80) + "..." : msg.content;
          process.stdout.write(dim(`  you: ${preview}\n`));
        } else if (msg.role === "assistant") {
          const text =
            typeof msg.content === "string"
              ? msg.content
              : Array.isArray(msg.content)
                ? msg.content
                    .filter((p: any) => p.type === "text")
                    .map((p: any) => p.text)
                    .join("")
                : "";
          if (text) {
            const firstLine = text.split("\n")[0];
            const preview = firstLine.length > 80 ? firstLine.slice(0, 80) + "..." : firstLine;
            process.stdout.write(dim(`  bot: ${preview}\n`));
          }
        }
      }
      process.stdout.write(dim("  ───\n"));
    }

    process.stdout.write(green("> "));

    this.rl.on("line", async (text) => {
      if (!text.trim()) {
        process.stdout.write(green("> "));
        return;
      }

      const spinner = new Spinner();
      process.stdout.write("\n");
      spinner.start("thinking...", `${blue("◆")} `);
      let hasText = false;
      let toolCount = 0;

      try {
        await onMessage(
          { text: text.trim(), userId: "cli", chatId: "cli", interface: "cli", channel: "terminal" },
          (event: StreamEvent) => {
            switch (event.type) {
              case "text-delta":
                if (!hasText) {
                  spinner.stop();
                  if (toolCount > 0) {
                    process.stdout.write("\n");
                  }
                  process.stdout.write(`${blue("◆")} `);
                  hasText = true;
                }
                process.stdout.write(event.text || "");
                break;

              case "tool-call":
                toolCount++;
                spinner.stop();
                const colorFn = TOOL_COLORS[event.toolName || ""] || yellow;
                process.stdout.write(
                  `  ${colorFn(event.toolName || "tool")} ${dim(event.toolDetail || "")}\n`
                );
                spinner.start("thinking...");
                break;

              case "tool-result":
                break;

              case "finish":
                spinner.stop();
                if (hasText) {
                  process.stdout.write(`\n\n${green("> ")}`);
                } else {
                  process.stdout.write(`${dim("(no response)")}\n\n${green("> ")}`);
                }
                break;

              case "error":
                spinner.stop();
                process.stdout.write(`\n${red(event.error || "Unknown error")}\n\n${green("> ")}`);
                break;
            }
          }
        );
      } catch {
        spinner.stop();
        if (!hasText) {
          process.stdout.write(green("> "));
        }
      }
    });
  }

  async stop(): Promise<void> {
    this.rl?.close();
  }
}

export { dim, bold, cyan, green, yellow, red };
