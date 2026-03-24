import { createInterface } from "readline";
import type { Interface, StartOptions } from "./types.js";

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
      // Show last few user/assistant exchanges
      const recent = history.slice(-6);
      for (const msg of recent) {
        if (msg.role === "user" && typeof msg.content === "string") {
          process.stdout.write(`> ${msg.content}\n`);
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
            const preview = text.length > 200 ? text.slice(0, 200) + "..." : text;
            process.stdout.write(`${preview}\n\n`);
          }
        }
      }
      process.stdout.write("---\n");
    }

    process.stdout.write("> ");

    this.rl.on("line", async (text) => {
      if (!text.trim()) {
        process.stdout.write("> ");
        return;
      }

      try {
        const response = await onMessage({
          text: text.trim(),
          userId: "cli",
          chatId: "cli",
        });
        process.stdout.write(`\n${response}\n\n> `);
      } catch (error: any) {
        process.stdout.write(`\nError: ${error.message}\n\n> `);
      }
    });
  }

  async stop(): Promise<void> {
    this.rl?.close();
  }
}
