import { createInterface } from "readline";
import type { Interface, IncomingMessage } from "./types.js";

export class CliInterface implements Interface {
  private rl: ReturnType<typeof createInterface> | null = null;

  async start(
    onMessage: (msg: IncomingMessage) => Promise<string>,
  ): Promise<void> {
    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    process.stdout.write("kern cli — type a message, press enter. ctrl+c to quit.\n\n> ");

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
