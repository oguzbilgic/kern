import { Runtime, type StreamEvent } from "./runtime.js";
import { TelegramInterface } from "./interfaces/telegram.js";
import { CliInterface, dim, bold, cyan } from "./interfaces/cli.js";
import { loadConfig } from "./config.js";
import { readFile } from "fs/promises";
import { join, basename } from "path";
import type { Interface, MessageHandler } from "./interfaces/types.js";
import { registerAgent, setPort } from "./registry.js";
import { AgentServer } from "./server.js";

export async function startApp(agentDir: string, forceCli = false): Promise<void> {
  const config = await loadConfig(agentDir);
  const runtime = new Runtime(agentDir);
  await runtime.init();

  const agentName = basename(agentDir);
  await registerAgent(agentName, agentDir);
  process.chdir(agentDir);

  // Start HTTP server
  const server = new AgentServer();

  // Handler for messages from any channel
  const handleMessage = async (text: string, userId: string, iface: string, channel: string) => {
    // Inject context for non-CLI
    const context = iface !== "cli" && iface !== "tui"
      ? `[via ${iface}${channel ? `, ${channel}` : ""}, user: ${userId}]\n${text}`
      : text;

    // Broadcast the incoming message to all SSE clients
    server.broadcast({
      type: "incoming" as any,
      text,
      fromInterface: iface,
      fromUserId: userId,
      fromChannel: channel,
    });

    await runtime.handleMessage(context, (event: StreamEvent) => {
      // Broadcast all events to SSE clients
      server.broadcast(event);
    });
  };

  server.setMessageHandler(handleMessage);

  const port = await server.start();
  await setPort(agentName, port);

  // Start Telegram if configured and not forced CLI
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!forceCli && telegramToken) {
    const allowedUsers = config.telegram?.allowedUsers || [];
    const telegram = new TelegramInterface(telegramToken, allowedUsers);
    await telegram.start({
      onMessage: async (msg, onEvent) => {
        const context = `[via ${msg.interface}${msg.channel ? `, ${msg.channel}` : ""}, user: ${msg.userId}]\n${msg.text}`;

        // Broadcast incoming to SSE clients
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
        const context = msg.text;
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
