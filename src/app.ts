import { Runtime, type StreamEvent } from "./runtime.js";
import { TelegramInterface } from "./interfaces/telegram.js";
import { SlackInterface } from "./interfaces/slack.js";
import { CliInterface, dim, bold, cyan } from "./interfaces/cli.js";
import { loadConfig } from "./config.js";
import { readFile } from "fs/promises";
import { join, basename } from "path";
import type { Interface, MessageHandler } from "./interfaces/types.js";
import { registerAgent, setPort } from "./registry.js";
import { AgentServer } from "./server.js";
import { PairingManager } from "./pairing.js";
import { setMessageSender } from "./tools/message.js";

export async function startApp(agentDir: string, forceCli = false): Promise<void> {
  const config = await loadConfig(agentDir);
  const runtime = new Runtime(agentDir);
  await runtime.init();

  const agentName = basename(agentDir);
  await registerAgent(agentName, agentDir);
  process.chdir(agentDir);

  // Initialize pairing
  const pairing = new PairingManager(agentDir);
  await pairing.load();

  // Pass pairing manager to runtime so kern tool can use it
  runtime.setPairingManager(pairing);

  // Start HTTP server
  const server = new AgentServer();

  // Handler for messages from any channel
  const handleMessage = async (text: string, userId: string, iface: string, channel: string) => {
    const context = `[via ${iface}${channel ? `, ${channel}` : ""}, user: ${userId}]\n${text}`;

    server.broadcast({
      type: "incoming" as any,
      text,
      fromInterface: iface,
      fromUserId: userId,
      fromChannel: channel,
    });

    await runtime.handleMessage(context, (event: StreamEvent) => {
      server.broadcast(event);
    });
  };

  server.setMessageHandler(handleMessage);

  const port = await server.start();
  await setPort(agentName, port);

  // Start Telegram if configured
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  let telegramBot: TelegramInterface | null = null;
  if (!forceCli && telegramToken) {
    telegramBot = new TelegramInterface(telegramToken, pairing);
    await telegramBot.start({
      onMessage: async (msg, onEvent) => {
        const context = `[via ${msg.interface}${msg.channel ? `, ${msg.channel}` : ""}, user: ${msg.userId}]\n${msg.text}`;

        server.broadcast({
          type: "incoming" as any,
          text: msg.text,
          fromInterface: msg.interface,
          fromUserId: msg.userId,
          fromChannel: msg.channel,
        });

        return runtime.handleMessage(context, (event: StreamEvent) => {
          onEvent(event);
          server.broadcast(event);
        });
      },
    });
  }

  // Start Slack if configured
  const slackBotToken = process.env.SLACK_BOT_TOKEN;
  const slackAppToken = process.env.SLACK_APP_TOKEN;
  let slackBot: SlackInterface | null = null;
  if (!forceCli && slackBotToken && slackAppToken) {
    slackBot = new SlackInterface(slackBotToken, slackAppToken, pairing);
    await slackBot.start({
      onMessage: async (msg, onEvent) => {
        const context = `[via ${msg.interface}${msg.channel ? `, ${msg.channel}` : ""}, user: ${msg.userId}]\n${msg.text}`;

        server.broadcast({
          type: "incoming" as any,
          text: msg.text,
          fromInterface: msg.interface,
          fromUserId: msg.userId,
          fromChannel: msg.channel,
        });

        return runtime.handleMessage(context, (event: StreamEvent) => {
          onEvent(event);
          server.broadcast(event);
        });
      },
    });
  }

  // Wire message tool — agent can send messages to users
  setMessageSender(async (userId: string, iface: string, text: string) => {
    if (iface === "telegram" && telegramBot) {
      const chatId = pairing.getChatId(userId) || userId;
      const sent = await telegramBot.sendToUser(chatId, text);
      if (sent) {
        server.broadcast({
          type: "outgoing" as any,
          text,
          fromInterface: iface,
          fromUserId: userId,
        });
      }
      return sent;
    }
    if (iface === "slack" && slackBot) {
      const chatId = pairing.getChatId(userId) || userId;
      const sent = await slackBot.sendToUser(chatId, text);
      if (sent) {
        server.broadcast({
          type: "outgoing" as any,
          text,
          fromInterface: iface,
          fromUserId: userId,
        });
      }
      return sent;
    }
    return false;
  });

  // Print header
  const w = (s: string) => process.stdout.write(s + "\n");
  let version = "unknown";
  try {
    const pkg = JSON.parse(await readFile(join(import.meta.dirname, "..", "package.json"), "utf-8"));
    version = pkg.version;
  } catch {}

  w("");
  w(`  ${bold("kern")} ${dim("v" + version)} ${cyan(agentDir)}`);
  w(`  ${"model"}    ${dim(config.provider + "/" + config.model)}`);
  w(`  ${"session"}  ${dim(runtime.getSessionId() || "new")}`);
  w(`  ${"tools"}    ${dim(config.toolScope)}`);
  w(`  ${"port"}     ${dim(String(port))}`);
  w(`  ${dim("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")}`);
  w("");

  // If forceCli, start CLI interface connected to same runtime
  if (forceCli) {
    const cli = new CliInterface();
    await cli.start({
      onMessage: async (msg, onEvent) => {
        const context = `[via ${msg.interface}${msg.channel ? `, ${msg.channel}` : ""}, user: ${msg.userId}]\n${msg.text}`;
        return runtime.handleMessage(context, (event: StreamEvent) => {
          onEvent(event);
          server.broadcast(event);
        });
      },
      history: runtime.getMessages(),
    });
  }

  // Graceful shutdown
  process.on("SIGTERM", () => {
    server.stop();
    process.exit(0);
  });
  process.on("SIGINT", () => {
    server.stop();
    process.exit(0);
  });
}
