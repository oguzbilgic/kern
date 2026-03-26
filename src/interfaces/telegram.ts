import { Bot } from "grammy";
import type { Interface, StartOptions } from "./types.js";
import type { PairingManager } from "../pairing.js";
import { log } from "../log.js";

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
  private pairing: PairingManager | null;

  constructor(token: string, pairing?: PairingManager) {
    this.bot = new Bot(token);
    this.pairing = pairing || null;
  }

  async start({ onMessage }: StartOptions): Promise<void> {
    this.bot.on("message:text", async (ctx) => {
      const userId = ctx.from.id;
      const text = ctx.message.text;
      const chatId = ctx.chat.id.toString();
      log("telegram", `message from ${userId}: ${text.slice(0, 50)}`);

      // Check pairing
      if (this.pairing && !this.pairing.isPaired(userId.toString())) {
        // Auto-pair first user ever — they become the operator
        if (!this.pairing.hasAnyPairedUsers()) {
          await this.pairing.autoPairFirst(userId.toString(), "telegram", chatId);
          // Fall through to normal message handling
        } else {
          const code = await this.pairing.getOrCreateCode(
            userId.toString(),
            "telegram",
            `telegram:${chatId}`,
          );
          await ctx.reply(
            `You're not paired with this agent.\n\nYour pairing code: <b>${code}</b>\n\nShare this code with the agent's operator to get access.`,
            { parse_mode: "HTML" },
          );
          return;
        }
      }

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
      let activeMessageId = reply.message_id;
      let textBlocks: string[] = [];
      let pendingNewMessage: Promise<void> | null = null;

      try {
        const response = await onMessage(
          { text, userId: userId.toString(), chatId, interface: "telegram", channel: `telegram:${chatId}` },
          (event) => {
            const now = Date.now();
            if (event.type === "tool-call") {
              // If we had text streaming, finalize that message and start new one for tools
              if (streaming && currentText) {
                this.editMessage(ctx, activeMessageId, currentText).catch(() => {});
                textBlocks.push(currentText);
                streaming = false;
                currentText = "";
                toolLines = [];
                // New message for tools + next text
                pendingNewMessage = ctx.reply("...").then((msg) => {
                  activeMessageId = msg.message_id;
                  pendingNewMessage = null;
                }).catch(() => { pendingNewMessage = null; });
              }
              const detail = event.toolDetail ? ` ${event.toolDetail}` : "";
              toolLines.push(`⚙ ${event.toolName}${detail}`);
              if (now - lastEditTime > 500 && !pendingNewMessage) {
                lastEditTime = now;
                this.editMessage(ctx, activeMessageId, toolLines.join("\n"), false).catch(() => {});
              }
            } else if (event.type === "text-delta") {
              if (!streaming) {
                streaming = true;
                currentText = "";
                toolLines = [];
              }
              currentText += event.text || "";
              if (now - lastEditTime > 1000 && !pendingNewMessage) {
                lastEditTime = now;
                this.editMessage(ctx, activeMessageId, currentText).catch(() => {});
              }
            }
          }
        );

        clearInterval(typingInterval);
        if (pendingNewMessage) await pendingNewMessage;
        // Final edit — overwrite tools with text on the last message
        const lastText = (currentText || response || "").trim();
        if (lastText === "NO_REPLY" || lastText === "(no text response)") {
          // Suppress — delete the placeholder message
          try { await ctx.api.deleteMessage(ctx.chat.id, activeMessageId); } catch {}
          // Delete any earlier placeholder too
          if (activeMessageId !== reply.message_id) {
            try { await ctx.api.deleteMessage(ctx.chat.id, reply.message_id); } catch {}
          }
        } else {
          await this.editMessage(ctx, activeMessageId, lastText);
        }
      } catch (error: any) {
        clearInterval(typingInterval);
        await this.editMessage(ctx, reply.message_id, `Error: ${error.message}`);
      }
    });

    log("telegram", "connected");
    this.bot.start();
  }

  async stop(): Promise<void> {
    this.bot.stop();
  }

  async sendToUser(chatId: string, text: string): Promise<boolean> {
    try {
      await this.bot.api.sendMessage(chatId, text);
      return true;
    } catch {
      return false;
    }
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
