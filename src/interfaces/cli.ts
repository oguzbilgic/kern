import { createInterface } from "readline";
import type { Interface, StartOptions } from "./types.js";

// ANSI colors
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

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
      process.stdout.write(dim("  recent history:\n"));
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

      try {
        const response = await onMessage({
          text: text.trim(),
          userId: "cli",
          chatId: "cli",
        });
        process.stdout.write(`\n${response}\n\n${green("> ")}`);
      } catch (error: any) {
        process.stdout.write(`\n${red(`Error: ${error.message}`)}\n\n${green("> ")}`);
      }
    });
  }

  async stop(): Promise<void> {
    this.rl?.close();
  }
}

// Export colors for use in runtime tool logging
export { dim, bold, cyan, green, yellow, red };
