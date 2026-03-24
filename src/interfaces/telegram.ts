import { Bot } from "grammy";
import type { Interface, StartOptions } from "./types.js";

function mdToHtml(text: string): string {
  // Convert common markdown to Telegram HTML
  // Order matters — do code blocks first to avoid processing inside them
  let html = text;

  // Code blocks: ```lang\n...\n``` → <pre><code>...</code></pre>
  html = html.replace(/```\w*\n([\s\S]*?)```/g, "<pre><code>$1</code></pre>");

  // Inline code: `...` → <code>...</code>
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Bold: **...** → <b>...</b>
  html = html.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");

  // Italic: *...* → <i>...</i>
  html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<i>$1</i>");

  // Strikethrough: ~~...~~ → <s>...</s>
  html = html.replace(/~~(.+?)~~/g, "<s>$1</s>");

  // Blockquotes: lines starting with > → <blockquote>
  html = html.replace(/(?:^|\n)(?:> (.+?)(?:\n|$))+/g, (match) => {
    const content = match.replace(/(?:^|\n)> /g, "\n").trim();
    return `\n<blockquote>${content}</blockquote>\n`;
  });

  // Lists: - item → • item (Telegram has no list tags)
  html = html.replace(/^- (.+)/gm, "• $1");

  return html;
}

export class TelegramInterface implements Interface {
  private bot: Bot;
  private allowedUsers: number[];

  constructor(token: string, allowedUsers: number[] = []) {
    this.bot = new Bot(token);
    this.allowedUsers = allowedUsers;
  }

  async start({ onMessage }: StartOptions): Promise<void> {
    this.bot.on("message:text", async (ctx) => {
      const userId = ctx.from.id;

      if (this.allowedUsers.length > 0 && !this.allowedUsers.includes(userId)) {
        await ctx.reply("Not authorized.");
        return;
      }

      const text = ctx.message.text;
      const chatId = ctx.chat.id.toString();

      await ctx.replyWithChatAction("typing");
      const reply = await ctx.reply("...");

      let lastEditTime = 0;
      let currentText = "";

      try {
        const response = await onMessage(
          { text, userId: userId.toString(), chatId, interface: "telegram", channel: `telegram:${chatId}` },
          (event) => {
            if (event.type === "text-delta") {
              currentText += event.text || "";
              const now = Date.now();
              if (now - lastEditTime > 1000) {
                lastEditTime = now;
                this.editMessage(ctx, reply.message_id, currentText).catch(() => {});
              }
            }
          }
        );

        await this.editMessage(ctx, reply.message_id, response);
      } catch (error: any) {
        await this.editMessage(ctx, reply.message_id, `Error: ${error.message}`);
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
      const truncated =
        text.length > 4000 ? text.slice(-4000) + "\n...(truncated)" : text;
      const html = mdToHtml(truncated || "...");
      await ctx.api.editMessageText(ctx.chat.id, messageId, html, { parse_mode: "HTML" });
    } catch {
      // HTML parse failed — fall back to plain text
      try {
        const truncated =
          text.length > 4000 ? text.slice(-4000) + "\n...(truncated)" : text;
        await ctx.api.editMessageText(ctx.chat.id, messageId, truncated || "...");
      } catch {
        // ignore
      }
    }
  }
}
