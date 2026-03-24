// @ts-ignore — bolt CJS/ESM interop
import { App as SlackApp } from "@slack/bolt";
import type { Interface, StartOptions } from "./types.js";
import type { PairingManager } from "../pairing.js";

export class SlackInterface implements Interface {
  private app: InstanceType<typeof SlackApp>;
  private pairing: PairingManager | null;
  private botUserId: string = "";

  constructor(botToken: string, appToken: string, pairing?: PairingManager) {
    this.app = new SlackApp({
      token: botToken,
      appToken,
      socketMode: true,
    });
    this.pairing = pairing || null;
  }

  async start({ onMessage }: StartOptions): Promise<void> {
    // Get bot's own user ID so we can detect @mentions and ignore own messages
    try {
      const auth = await this.app.client.auth.test();
      this.botUserId = auth.user_id as string || "";
    } catch {}

    // Listen to all messages
    this.app.message(async ({ message, say, client }: any) => {
      // Skip bot messages and message_changed events
      if (!("user" in message) || !("text" in message)) return;
      if (message.user === this.botUserId) return;

      const userId = message.user;
      const text = message.text || "";
      const channelId = message.channel;
      const threadTs = ("thread_ts" in message ? message.thread_ts : undefined) as string | undefined;

      // Determine if DM or channel
      let channelName = channelId;
      let isDM = false;
      try {
        const info = await client.conversations.info({ channel: channelId });
        if (info.channel) {
          isDM = info.channel.is_im || false;
          channelName = isDM ? `slack-dm:${userId}` : `#${info.channel.name || channelId}`;
        }
      } catch {}

      // Check pairing for DMs
      if (isDM && this.pairing && !this.pairing.isPaired(userId)) {
        const code = await this.pairing.getOrCreateCode(userId, "slack", channelName);
        await say(`You're not paired with this agent.\n\nYour pairing code: *${code}*\n\nShare this code with the agent's operator to get access.`);
        return;
      }

      // Detect @mention
      const isMentioned = text.includes(`<@${this.botUserId}>`);
      // Clean @mention from text
      const cleanText = text.replace(new RegExp(`<@${this.botUserId}>`, "g"), "").trim();

      if (!cleanText) return;

      // Build channel label
      const channelLabel = isDM ? `slack-dm` : channelName;

      try {
        const response = await onMessage(
          {
            text: cleanText,
            userId,
            chatId: channelId,
            interface: "slack",
            channel: channelLabel,
          },
          () => {}, // events handled by SSE broadcast in app.ts
        );

        // NO_REPLY suppression
        if (response && response.trim() !== "NO_REPLY") {
          await say(response);
        }
      } catch (error: any) {
        if (isDM) {
          await say(`Error: ${error.message}`);
        }
      }
    });

    await this.app.start();
    console.log("Slack bot starting (socket mode)...");
  }

  async stop(): Promise<void> {
    await this.app.stop();
  }

  async sendToUser(channelId: string, text: string): Promise<boolean> {
    try {
      await this.app.client.chat.postMessage({
        channel: channelId,
        text,
      });
      return true;
    } catch {
      return false;
    }
  }
}
