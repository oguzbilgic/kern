import { Runtime, type StreamEvent } from "./runtime.js";
import { updateKernel } from "./kernel.js";
import { TelegramInterface } from "./interfaces/telegram.js";
import { SlackInterface } from "./interfaces/slack.js";
import { CliInterface } from "./interfaces/cli.js";
import { loadConfig } from "./config.js";
import { readFile, appendFile } from "fs/promises";
import { join, basename } from "path";
import { randomBytes } from "crypto";
import type { Interface, MessageHandler } from "./interfaces/types.js";
import { registerAgent, setPort, setToken } from "./registry.js";
import { AgentServer } from "./server.js";
import { PairingManager } from "./pairing.js";
import { setMessageSender } from "./tools/message.js";
import { MessageQueue } from "./queue.js";
import { log } from "./log.js";

export async function startApp(agentDir: string, forceCli = false): Promise<void> {
  // Update kernel if newer version available
  await updateKernel(agentDir);

  const config = await loadConfig(agentDir);

  // Auto-generate auth token if missing
  if (!process.env.KERN_AUTH_TOKEN) {
    const token = randomBytes(16).toString("hex");
    const envPath = join(agentDir, ".kern", ".env");
    await appendFile(envPath, `\nKERN_AUTH_TOKEN=${token}\n`);
    process.env.KERN_AUTH_TOKEN = token;
    log("kern", `generated auth token: ${token}`);
  }

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

  // Log + start
  let version = "unknown";
  try {
    const pkg = JSON.parse(await readFile(join(import.meta.dirname, "..", "package.json"), "utf-8"));
    version = pkg.version;
  } catch {}
  const hb = config.heartbeatInterval > 0 ? `, heartbeat:${config.heartbeatInterval}min` : "";
  log("kern", `starting ${agentName} — v${version}, ${config.model}, tools:${config.toolScope}${hb}`);

  // Start HTTP server
  const server = new AgentServer();

  // Message queue — serializes messages, same-channel injection
  const queue = new MessageQueue();

  queue.setHandler(async (msg, getPendingMessages) => {
    const cmd = msg.text.trim();

    // Intercept /restart — handle at runtime level, never send to LLM
    if (cmd === "/restart") {
      log("kern", `restart requested by ${msg.userId} via ${msg.interface}`);
      setTimeout(async () => {
        const { spawn } = await import("child_process");
        spawn("kern", ["restart", agentName], { detached: true, stdio: "ignore" }).unref();
      }, 2000);
      return "Restarting in 2 seconds...";
    }

    // Intercept /status — calls the same kern tool status action, no LLM
    if (cmd === "/status") {
      const { getStatus } = await import("./tools/kern.js");
      return getStatus();
    }

    const time = new Date().toISOString();
    const context = `[via ${msg.interface}${msg.channel ? `, ${msg.channel}` : ""}, user: ${msg.userId}, time: ${time}]\n${msg.text}`;

    // Broadcast incoming to TUI
    if (!msg.isHeartbeat) {
      server.broadcast({
        type: "incoming" as any,
        text: msg.text,
        fromInterface: msg.interface,
        fromUserId: msg.userId,
        fromChannel: msg.channel,
      });
    }

    // Set up prepareStep injection for same-channel messages
    runtime.setPendingInjections(() => {
      const pending = getPendingMessages();
      return pending.map((p) => ({
        role: "user",
        content: `[via ${p.interface}${p.channel ? `, ${p.channel}` : ""}, user: ${p.userId}, time: ${new Date().toISOString()}]\n${p.text}`,
      }));
    });

    return runtime.handleMessage(context, (event: StreamEvent) => {
      server.broadcast(event);
      msg.onEvent?.(event);
    });
  });

  // Helper to enqueue from any interface
  const enqueueMessage = (text: string, userId: string, iface: string, channel: string, onEvent?: (e: StreamEvent) => void) => {
    return queue.enqueue({ text, userId, interface: iface, channel }, onEvent);
  };

  server.setStatusFn(() => ({
    model: config.model,
    provider: config.provider,
    toolScope: config.toolScope,
    agentName,
  }));

  server.setMessageHandler(async (text, userId, iface, channel) => {
    await enqueueMessage(text, userId, iface, channel);
  });

  // History: return messages from session, paginated
  server.setHistoryFn((limit: number, before?: number) => {
    const msgs = runtime.getMessages();
    const end = before !== undefined ? before : msgs.length;
    const start = Math.max(0, end - limit);
    return msgs.slice(start, end).map((m: any, i: number) => ({
      index: start + i,
      ...m,
    }));
  });

  const port = await server.start(config.host);
  await setPort(agentName, port);
  await setToken(agentName, process.env.KERN_AUTH_TOKEN || null);

  // Start Telegram if configured
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  let telegramBot: TelegramInterface | null = null;
  if (!forceCli && telegramToken) {
    telegramBot = new TelegramInterface(telegramToken, pairing);
    await telegramBot.start({
      onMessage: async (msg, onEvent) => {
        return enqueueMessage(msg.text, msg.userId, msg.interface, msg.channel || "", onEvent);
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
        return enqueueMessage(msg.text, msg.userId, msg.interface, msg.channel || "");
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

  log("kern", `started ${agentName}`);

  // If forceCli, start CLI interface connected to same runtime (also goes through queue)
  if (forceCli) {
    const cli = new CliInterface();
    await cli.start({
      onMessage: async (msg, onEvent) => {
        return enqueueMessage(msg.text, msg.userId, msg.interface, msg.channel || "");
      },
      history: runtime.getMessages(),
    });
  }

  // Heartbeat — goes through queue as low priority
  if (config.heartbeatInterval > 0) {
    const intervalMs = config.heartbeatInterval * 60 * 1000;
    setInterval(async () => {
      try {
        const tuiStatus = server.hasConnectedClients() ? "connected" : "disconnected";
        const heartbeatText = `[heartbeat, tui: ${tuiStatus}]`;

        server.broadcast({
          type: "heartbeat" as any,
          text: heartbeatText,
        });

        await queue.enqueue({
          text: heartbeatText,
          userId: "system",
          interface: "system",
          channel: "heartbeat",
          isHeartbeat: true,
        });
      } catch (e: any) {
        process.stderr.write(`[kern] heartbeat error: ${e.message}\n`);
      }
    }, intervalMs);
  }

  // Graceful shutdown
  process.on("SIGTERM", () => {
    log("kern", `stopped ${agentName}`);
    server.stop();
    process.exit(0);
  });
  process.on("SIGINT", () => {
    log("kern", `stopped ${agentName}`);
    server.stop();
    process.exit(0);
  });
}
