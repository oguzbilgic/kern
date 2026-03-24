import { Bot } from "grammy";
import type { Interface, IncomingMessage } from "./types.js";

export class TelegramInterface implements Interface {
  private bot: Bot;
  private allowedUsers: number[];

  constructor(token: string, allowedUsers: number[] = []) {
    this.bot = new Bot(token);
    this.allowedUsers = allowedUsers;
  }

  async start(
    onMessage: (msg: IncomingMessage) => Promise<string>,
  ): Promise<void> {
    this.bot.on("message:text", async (ctx) => {
      const userId = ctx.from.id;

      // Check allowlist
      if (this.allowedUsers.length > 0 && !this.allowedUsers.includes(userId)) {
        await ctx.reply("Not authorized.");
        return;
      }

      const text = ctx.message.text;
      const chatId = ctx.chat.id.toString();

      // Send typing indicator
      await ctx.replyWithChatAction("typing");

      // Send initial "thinking" message that we'll edit with streaming updates
      const reply = await ctx.reply("...");

      let lastEdit = 0;
      const EDIT_INTERVAL = 1000; // Edit at most every 1s to avoid rate limits

      try {
        const response = await onMessage({
          text,
          userId: userId.toString(),
          chatId,
        });

        // Final edit with complete response
        await this.editMessage(ctx, reply.message_id, response);
      } catch (error: any) {
        await this.editMessage(
          ctx,
          reply.message_id,
          `Error: ${error.message}`,
        );
      }
    });

    console.log("Telegram bot starting (long polling)...");
    this.bot.start();
  }

  async stop(): Promise<void> {
    this.bot.stop();
  }

  private async editMessage(
    ctx: any,
    messageId: number,
    text: string,
  ): Promise<void> {
    try {
      // Telegram has a 4096 char limit per message
      const truncated =
        text.length > 4000 ? text.slice(-4000) + "\n...(truncated)" : text;
      await ctx.api.editMessageText(ctx.chat.id, messageId, truncated || "...");
    } catch {
      // Edit can fail if text hasn't changed, ignore
    }
  }
}
