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
    });

    console.log("kern cli — type a message, press enter. ctrl+c to quit.\n");

    const prompt = () => {
      this.rl!.question("> ", async (text) => {
        if (!text.trim()) {
          prompt();
          return;
        }

        try {
          const response = await onMessage({
            text: text.trim(),
            userId: "cli",
            chatId: "cli",
          });
          console.log(`\n${response}\n`);
        } catch (error: any) {
          console.error(`\nError: ${error.message}\n`);
        }

        prompt();
      });
    };

    prompt();
  }

  async stop(): Promise<void> {
    this.rl?.close();
  }
}
