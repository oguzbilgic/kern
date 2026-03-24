import { createInterface } from "readline";
import type { Interface, StartOptions } from "./types.js";
import type { StreamEvent } from "../runtime.js";

// ANSI
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

class Spinner {
  private interval: ReturnType<typeof setInterval> | null = null;
  private frame = 0;

  start(label = "thinking") {
    this.frame = 0;
    this.interval = setInterval(() => {
      const s = SPINNER[this.frame % SPINNER.length];
      process.stderr.write(`\r${dim(`${s} ${label}`)}`);
      this.frame++;
    }, 80);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      process.stderr.write("\r\x1b[K"); // clear line
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

    // Show recent history
    if (history && history.length > 0) {
      const recent = history.slice(-6);
      for (const msg of recent) {
        if (msg.role === "user" && typeof msg.content === "string") {
          process.stdout.write(dim(`  > ${msg.content}\n`));
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
            const preview = text.length > 150 ? text.slice(0, 150) + "..." : text;
            process.stdout.write(dim(`  ${preview}\n\n`));
          }
        }
      }
      process.stdout.write("\n");
    }

    process.stdout.write(green("> "));

    this.rl.on("line", async (text) => {
      if (!text.trim()) {
        process.stdout.write(green("> "));
        return;
      }

      const spinner = new Spinner();
      spinner.start();
      let hasOutput = false;
      let inToolSequence = false;

      try {
        await onMessage(
          { text: text.trim(), userId: "cli", chatId: "cli" },
          (event: StreamEvent) => {
            switch (event.type) {
              case "text-delta":
                if (!hasOutput) {
                  spinner.stop();
                  process.stdout.write("\n");
                  hasOutput = true;
                  inToolSequence = false;
                }
                process.stdout.write(event.text || "");
                break;

              case "tool-call":
                spinner.stop();
                if (!inToolSequence && hasOutput) {
                  process.stdout.write("\n");
                }
                process.stdout.write(
                  dim(`  ${yellow(event.toolName || "tool")} ${event.toolDetail || ""}\n`)
                );
                inToolSequence = true;
                // Restart spinner while tool executes
                spinner.start(event.toolName || "running");
                break;

              case "tool-result":
                spinner.stop();
                break;

              case "finish":
                spinner.stop();
                if (hasOutput) {
                  process.stdout.write(`\n\n${green("> ")}`);
                } else {
                  process.stdout.write(`\n${dim("(no response)")}\n\n${green("> ")}`);
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
        // Error already handled via event
        if (!hasOutput) {
          process.stdout.write(`\n${green("> ")}`);
        }
      }
    });
  }

  async stop(): Promise<void> {
    this.rl?.close();
  }
}

export { dim, bold, cyan, green, yellow, red };
