import { Bot } from "grammy";
import type { Interface, StartOptions } from "./types.js";

function mdToHtml(text: string): string {
  let html = text;

  // Code blocks first — protect from other replacements
  html = html.replace(/```\w*\n([\s\S]*?)```/g, "<pre><code>$1</code></pre>");

  // Inline code
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Bold: **...** → <b>...</b>
  html = html.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");

  // Italic: *...* (but not inside bold)
  html = html.replace(/(?<![*<])(\*)(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<i>$2</i>");

  // Strikethrough
  html = html.replace(/~~(.+?)~~/g, "<s>$1</s>");

  // Lists: - item → • item
  html = html.replace(/^- /gm, "• ");

  // Blockquotes: > line
  html = html.replace(/^> (.+)$/gm, "<blockquote>$1</blockquote>");
  // Merge adjacent blockquotes
  html = html.replace(/<\/blockquote>\n<blockquote>/g, "\n");

  // Escape < and > that aren't part of our tags
  // Skip — too risky to break our tags. Telegram is lenient.

  return html;
}

function stripMarkdown(text: string): string {
  let plain = text;
  plain = plain.replace(/```\w*\n([\s\S]*?)```/g, "$1");
  plain = plain.replace(/`([^`]+)`/g, "$1");
  plain = plain.replace(/\*\*(.+?)\*\*/g, "$1");
  plain = plain.replace(/(?<![*])(\*)(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "$2");
  plain = plain.replace(/~~(.+?)~~/g, "$1");
  plain = plain.replace(/^- /gm, "• ");
  plain = plain.replace(/^> /gm, "");
  return plain;
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

      // Keep typing indicator alive every 4s (Telegram expires it after 5s)
      const typingInterval = setInterval(() => {
        ctx.replyWithChatAction("typing").catch(() => {});
      }, 4000);
      await ctx.replyWithChatAction("typing");
      const reply = await ctx.reply("...");

      let lastEditTime = 0;
      let currentText = "";
      let toolLines: string[] = [];
      let streaming = false;

      try {
        const response = await onMessage(
          { text, userId: userId.toString(), chatId, interface: "telegram", channel: `telegram:${chatId}` },
          (event) => {
            const now = Date.now();
            if (event.type === "tool-call") {
              const detail = event.toolDetail ? ` ${event.toolDetail}` : "";
              toolLines.push(`⚙ ${event.toolName}${detail}`);
              if (now - lastEditTime > 500) {
                lastEditTime = now;
                this.editMessage(ctx, reply.message_id, toolLines.join("\n"), false).catch(() => {});
              }
            } else if (event.type === "text-delta") {
              if (!streaming) {
                streaming = true;
                currentText = "";
              }
              currentText += event.text || "";
              if (now - lastEditTime > 1000) {
                lastEditTime = now;
                this.editMessage(ctx, reply.message_id, currentText).catch(() => {});
              }
            }
          }
        );

        clearInterval(typingInterval);
        await this.editMessage(ctx, reply.message_id, response);
      } catch (error: any) {
        clearInterval(typingInterval);
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
    useHtml = true,
  ): Promise<void> {
    const truncated =
      text.length > 4000 ? text.slice(-4000) + "\n...(truncated)" : text;
    const content = truncated || "...";
    if (!useHtml) {
      try {
        await ctx.api.editMessageText(ctx.chat.id, messageId, content);
      } catch { /* ignore */ }
      return;
    }
    try {
      await ctx.api.editMessageText(ctx.chat.id, messageId, mdToHtml(content), { parse_mode: "HTML" });
    } catch {
      try {
        await ctx.api.editMessageText(ctx.chat.id, messageId, stripMarkdown(content));
      } catch { /* ignore */ }
    }
  }
}
