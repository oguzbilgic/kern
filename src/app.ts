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
import { registerAgent, setPortAndToken, setPid } from "./registry.js";
import { AgentServer } from "./server.js";
import { PairingManager } from "./pairing.js";
import { setMessageSender } from "./tools/message.js";
import { setRecallIndex } from "./tools/recall.js";
import { RecallIndex } from "./recall.js";
import { SegmentIndex } from "./segments.js";
import { MemoryDB } from "./memory.js";
import { regenerateNotesSummary } from "./notes.js";
import { MessageQueue } from "./queue.js";
import { getStatusData as getStatusDataFn, setQueueStatusFn, setInterfaceStatusFn, setRecallStatsFn, setSegmentStatsFn, type InterfaceStatus } from "./tools/kern.js";
import { log } from "./log.js";

async function handleSlashCommand(cmd: string, userId: string, iface: string, agentName: string): Promise<string | null> {
  switch (cmd) {
    case "/restart": {
      log("kern", `restart requested by ${userId} via ${iface}`);
      const { spawn } = await import("child_process");
      const child = spawn("kern", ["restart", agentName], { stdio: "pipe" });

      const result = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
        let stderr = "";
        child.stderr.on("data", (chunk) => {
          stderr += chunk.toString();
        });
        child.on("close", (code) => resolve({ code, stderr: stderr.trim() }));
        child.on("error", (err) => resolve({ code: 1, stderr: err.message }));
      });

      if (result.code === 0) {
        return "Restart initiated.";
      }

      return `Restart failed: ${result.stderr || `exit code ${result.code}`}`;
    }

    case "/status": {
      const { formatStatus } = await import("./tools/kern.js");
      return formatStatus(getStatusDataFn());
    }

    case "/help":
      return [
        "/status   — show agent status, uptime, token usage",
        "/restart  — restart the agent process",
        "/help     — show this help",
      ].join("\n");

    default:
      return null; // unknown command — fall through to LLM
  }
}

export async function startApp(agentDir: string, forceCli = false): Promise<void> {
  // Update kernel if newer version available
  await updateKernel(agentDir);

  const config = await loadConfig(agentDir);

  // Auto-generate auth token if missing
  if (!process.env.KERN_AUTH_TOKEN) {
    const envPath = join(agentDir, ".kern", ".env");
    // Check if token already exists in file (env might not have loaded it)
    let existingToken: string | null = null;
    try {
      const envContent = await readFile(envPath, "utf-8");
      const match = envContent.match(/^KERN_AUTH_TOKEN=(.+)$/m);
      if (match) existingToken = match[1].trim();
    } catch {}

    if (existingToken) {
      process.env.KERN_AUTH_TOKEN = existingToken;
    } else {
      const token = randomBytes(16).toString("hex");
      await appendFile(envPath, `\nKERN_AUTH_TOKEN=${token}\n`);
      process.env.KERN_AUTH_TOKEN = token;
      log("kern", `generated auth token: ${token.slice(0, 8)}...`);
    }
  }

  const runtime = new Runtime(agentDir);
  await runtime.init();

  // Initialize memory DB (always) and recall index (opt-out via "recall": false)
  const memoryDB = new MemoryDB(agentDir);
  runtime.setMemoryDB(memoryDB);

  let recallIndex: RecallIndex | null = null;
  let recallBuilding = false;
  if (config.recall !== false) {
    try {
      recallIndex = new RecallIndex(memoryDB, agentDir, config.provider);
      setRecallIndex(recallIndex);
      runtime.setRecallIndex(recallIndex);
      setRecallStatsFn(() => {
        if (!recallIndex) return null;
        const stats = recallIndex.getStats();
        return { ...stats, building: recallBuilding };
      });

      // Backfill in background — don't block startup
      const sessionId = runtime.getSessionId();
      if (sessionId) {
        recallBuilding = true;
        recallIndex.indexSession(sessionId).then((indexed) => {
          recallBuilding = false;
          if (indexed > 0) {
            log("recall", `backfilled ${indexed} chunks`);
          }
        }).catch((err) => {
          recallBuilding = false;
          log.error("recall", `backfill failed: ${err.message}`);
        });
      }
    } catch (err: any) {
      log.error("recall", `init failed: ${err.message} — recall disabled`);
    }
  }

  // Initialize semantic segments (uses same embedding infra as recall)
  let segmentIndex: SegmentIndex | null = null;
  let segmentRunning = false;
  if (config.recall !== false) {
    try {
      segmentIndex = new SegmentIndex(memoryDB, config.provider);
      runtime.setSegmentIndex(segmentIndex);
      setSegmentStatsFn(() => segmentIndex ? segmentIndex.getStats() : null);
    } catch (err: any) {
      log.error("segments", `init failed: ${err.message} — segments disabled`);
    }
  }

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
  server.setAgentDir(agentDir);

  // Message queue — serializes messages, same-channel injection
  const queue = new MessageQueue();
  setQueueStatusFn(() => queue.getStatus());

  queue.setHandler(async (msg, getPendingMessages) => {

    const time = new Date().toISOString();
    const context = `[via ${msg.interface}${msg.channel ? `, ${msg.channel}` : ""}, user: ${msg.userId}, time: ${time}]\n${msg.text}`;

    // Broadcast incoming to other clients.
    // Messages from /message POST (web, tui) are already broadcast by the server
    // with sender exclusion. Only broadcast here for adapter interfaces
    // (Telegram, Slack) which don't go through the HTTP endpoint.
    const httpInterfaces = ["web", "tui"];
    if (!msg.isHeartbeat && !httpInterfaces.includes(msg.interface)) {
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

    const result = await runtime.handleMessage(context, (event: StreamEvent) => {
      server.broadcast(event);
      msg.onEvent?.(event);
    }, msg.attachments);

    // Index new messages for recall + segments (async, non-blocking)
    const sessionId = runtime.getSessionId();
    if (sessionId) {
      if (recallIndex) {
        recallIndex.indexSession(sessionId).catch((err) => {
          log.error("recall", `indexing failed: ${err.message}`);
        });
      }
      if (segmentIndex) {
        segmentIndex.indexSession(sessionId).catch((err) => {
          log.error("segments", `indexing failed: ${err.message}`);
        });
      }
    }

    return result;
  });

  // Helper to enqueue from any interface
  const enqueueMessage = async (text: string, userId: string, iface: string, channel: string, onEvent?: (e: StreamEvent) => void, attachments?: import("./interfaces/types.js").Attachment[]) => {
    // Slash commands bypass the queue — instant response even if queue is busy
    const cmd = text.trim();
    if (cmd.startsWith("/")) {
      const result = await handleSlashCommand(cmd, userId, iface, agentName);
      if (result !== null) {
        server.broadcast({
          type: "command-result" as any,
          text: result,
          command: cmd,
        });
        return result;
      }
    }
    return queue.enqueue({ text, userId, interface: iface, channel, attachments }, onEvent);
  };

  server.setStatusFn(() => {
    return { ...getStatusDataFn(), agentName };
  });

  server.setMessageHandler(async (text, userId, iface, channel, attachments) => {
    await enqueueMessage(text, userId, iface, channel, undefined, attachments);
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

  server.setSystemPromptFn(async () => {
    const latestSystem = await runtime.getSystemPrompt();
    const built = runtime.buildPromptContext();
    return { system: built.system || latestSystem };
  });

  server.setContextSegmentsFn(() => {
    if (!segmentIndex) return { segments: [], tokenCount: 0 };
    const sessionId = runtime.getSessionId();
    if (!sessionId) return { segments: [], tokenCount: 0 };

    const messages = runtime.getMessages();
    const built = runtime.buildPromptContext();
    const summaryBudget = Math.round(config.maxContextTokens * (config.summaryBudget || 0));
    const trimmedCount = Math.max(0, messages.length - (built.messages?.length || messages.length));
    if (trimmedCount <= 0 || summaryBudget <= 0) return { segments: [], tokenCount: 0 };

    const history = segmentIndex.composeHistory(sessionId, trimmedCount, summaryBudget);
    if (!history) return { segments: [], tokenCount: 0 };

    return {
      tokenCount: history.tokens,
      segments: history.segments.map((seg) => ({
        id: seg.id,
        level: seg.level,
        msg_start: seg.msg_start,
        msg_end: seg.msg_end,
      })),
    };
  });

  server.setSegmentsFn((sessionId?: string) => {
    if (!segmentIndex) return { segments: [], stats: { segments: 0, level0: 0 } };
    return segmentIndex.getSegments(sessionId);
  });

  server.setSegmentsRebuildFn(async () => {
    if (!segmentIndex) throw new Error("segments not enabled");
    if (segmentRunning) {
      log("segments", "rebuild already running");
      return { status: "already running" };
    }
    const sessionId = runtime.getSessionId();
    if (!sessionId) throw new Error("no session");

    segmentRunning = true;
    try {
      segmentIndex.clear();
      log("segments", "cleared — starting rebuild");
      const created = await segmentIndex.indexSession(sessionId);
      log("segments", `rebuild complete: ${created} segments`);
      return { status: "done", segments: created };
    } finally {
      segmentRunning = false;
    }
  });

  server.setSegmentsStopFn(() => {
    if (!segmentIndex) return;
    segmentIndex.stop();
    segmentRunning = false;
  });

  server.setSegmentsCleanFn(() => {
    if (!segmentIndex) return;
    segmentIndex.clear();
  });

  server.setSegmentsStartFn(async () => {
    if (!segmentIndex) throw new Error("segments not enabled");
    if (segmentRunning) return { status: "already running" };
    const sessionId = runtime.getSessionId();
    if (!sessionId) throw new Error("no session");

    segmentRunning = true;
    try {
      const created = await segmentIndex.indexSession(sessionId);
      log("segments", `indexed ${created} new segments`);
      return { status: "done", segments: created };
    } finally {
      segmentRunning = false;
    }
  });

  server.setSegmentResummarizeFn(async (id: number) => {
    if (!segmentIndex) throw new Error("segments not enabled");
    return segmentIndex.resummarizeSegment(id);
  });

  // Notes summaries API
  server.setSummariesFn(() => {
    return memoryDB.getAllSummaries("daily_notes");
  });

  server.setSummaryRegenerateFn(async () => {
    return regenerateNotesSummary(agentDir, config, memoryDB);
  });

  // Sessions API
  server.setSessionListFn(() => {
    return memoryDB.getSessionList();
  });

  server.setCurrentSessionIdFn(() => {
    return runtime.getSessionId();
  });

  server.setSessionActivityFn((sessionId: string) => {
    return {
      daily: memoryDB.getSessionActivity(sessionId),
      hourly: memoryDB.getSessionHourlyActivity(sessionId),
    };
  });

  // Recall API
  if (recallIndex) {
    server.setRecallStatsFn(() => {
      const stats = recallIndex!.getStats();
      return { ...stats, building: recallBuilding };
    });

    server.setRecallSearchFn(async (query: string, limit: number) => {
      const results = await recallIndex!.search(query, limit);
      return { query, results };
    });
  }

  const port = await server.start("127.0.0.1");
  await setPortAndToken(agentName, port, process.env.KERN_AUTH_TOKEN || null);
  await setPid(agentName, process.pid);

  // Start Telegram if configured
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  let telegramBot: TelegramInterface | null = null;
  if (!forceCli && telegramToken) {
    telegramBot = new TelegramInterface(telegramToken, pairing);
    await telegramBot.start({
      onMessage: async (msg, onEvent) => {
        return enqueueMessage(msg.text, msg.userId, msg.interface, msg.channel || "", onEvent, msg.attachments);
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
        return enqueueMessage(msg.text, msg.userId, msg.interface, msg.channel || "", undefined, msg.attachments);
      },
    });
  }

  // Register interface status reporting
  setInterfaceStatusFn(() => {
    const statuses: InterfaceStatus[] = [];
    if (telegramBot) {
      statuses.push({ name: "telegram", status: telegramBot.status, detail: telegramBot.statusDetail });
    }
    if (slackBot) {
      statuses.push({ name: "slack", status: slackBot.status, detail: slackBot.statusDetail });
    }
    return statuses;
  });

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
  const shutdown = async () => {
    log("kern", `stopping ${agentName}`);
    if (telegramBot) await telegramBot.stop().catch(() => {});
    if (slackBot) await slackBot.stop().catch(() => {});
    server.stop();
    memoryDB.close();
    log("kern", `stopped ${agentName}`);
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
