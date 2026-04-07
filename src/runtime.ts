import { streamText, type ModelMessage, stepCountIs } from "ai";
import { join } from "path";
import { log } from "./log.js";
import { createModel } from "./model.js";
import { allTools, type ToolName } from "./tools/index.js";
import { SessionManager } from "./session.js";
import { estimateTextTokens } from "./context.js";
import { loadConfig, getToolsForScope, type KernConfig } from "./config.js";
import { initKernTool, incrementMessageCount, addTokenUsage } from "./tools/kern.js";
import type { RecallIndex } from "./recall.js";
import type { SegmentIndex } from "./segments.js";
import type { MemoryDB } from "./memory.js";
import { prepareContext, injectRecall, loadSystemPrompt, buildSystemMessage, addCacheBreakpoints, type PrepareContextOptions } from "./context.js";
import type { Attachment } from "./interfaces/types.js";
import { saveMedia, buildUserContent, extractText, MediaSidecar, resolveMediaInMessages, digestMediaAtIngest } from "./media.js";
export type { SessionStats } from "./context.js";



export interface StreamEvent {
  type: "text-delta" | "tool-call" | "tool-result" | "finish" | "error" | "recall" | "thinking";
  text?: string;
  toolName?: string;
  toolDetail?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: string;
  error?: string;
  recall?: { query: string; chunks: number; tokens: number; results: Array<{ timestamp: string; text: string; distance: number }> };
}

export type StreamHandler = (event: StreamEvent) => void;

export class Runtime {
  private config!: KernConfig;
  private systemPrompt!: string;
  private session!: SessionManager;
  private agentDir: string;
  private recallIndex: RecallIndex | null = null;
  private segmentIndex: SegmentIndex | null = null;
  private memoryDB: MemoryDB | null = null;
  private mediaSidecar: MediaSidecar | null = null;

  constructor(agentDir: string) {
    this.agentDir = agentDir;
  }

  setRecallIndex(index: RecallIndex) {
    this.recallIndex = index;
  }

  setSegmentIndex(index: SegmentIndex) {
    this.segmentIndex = index;
  }

  setMemoryDB(db: MemoryDB) {
    this.memoryDB = db;
  }

  private initMediaSidecar(): void {
    const sessionId = this.session.getSessionId();
    if (!sessionId) return;
    const sessionsDir = join(this.agentDir, ".kern", "sessions");
    this.mediaSidecar = new MediaSidecar(sessionsDir, sessionId, this.memoryDB);
    this.mediaSidecar.load();
  }

  async setPairingManager(pairing: any): Promise<void> {
    const { initKernTool } = await import("./tools/kern.js");
    await initKernTool({
      agentDir: this.agentDir,
      config: this.config,
      sessionId: this.session.getSessionId() || "unknown",
      getSessionStats: () => {
        const prepared = prepareContext({ messages: this.session.getMessages(), config: this.config, sessionId: this.session.getSessionId() || undefined, segmentIndex: this.segmentIndex });
        const summaryChars = prepared.systemAdditions.join("\n\n").length;
        prepared.stats.systemPromptTokens = estimateTextTokens(this.systemPrompt) + (summaryChars > 0 ? estimateTextTokens("\n\n") : 0);
        return prepared.stats;
      },
      pairingManager: pairing,
    });
  }

  async init(): Promise<void> {
    this.config = await loadConfig(this.agentDir);
    this.systemPrompt = await loadSystemPrompt(this.agentDir, this.config, this.memoryDB);
    this.session = new SessionManager(this.agentDir);
    await this.session.init();
    await this.session.load();

    // Initialize media sidecar for this session
    this.initMediaSidecar();

    await initKernTool({
      agentDir: this.agentDir,
      config: this.config,
      sessionId: this.session.getSessionId() || "unknown",
      getSessionStats: () => {
        const prepared = prepareContext({ messages: this.session.getMessages(), config: this.config, sessionId: this.session.getSessionId() || undefined, segmentIndex: this.segmentIndex });
        const summaryChars = prepared.systemAdditions.join("\n\n").length;
        prepared.stats.systemPromptTokens = estimateTextTokens(this.systemPrompt) + (summaryChars > 0 ? estimateTextTokens("\n\n") : 0);
        return prepared.stats;
      },
    });
  }

  // Pending messages to inject via prepareStep
  private pendingInjections: (() => { role: string; content: string }[]) | null = null;

  setPendingInjections(fn: () => { role: string; content: string }[]) {
    this.pendingInjections = fn;
  }

  buildPromptContext(options?: Partial<PrepareContextOptions>) {
    const allMessages = options?.messages ?? this.session.getMessages();
    const sessionId = options?.sessionId ?? (this.session.getSessionId() || undefined);
    const prepared = prepareContext({
      messages: allMessages,
      config: options?.config ?? this.config,
      sessionId,
      segmentIndex: options?.segmentIndex ?? this.segmentIndex,
    });
    const effectiveSystemPrompt = prepared.systemAdditions.length > 0
      ? `${this.systemPrompt}\n\n${prepared.systemAdditions.join("\n\n")}`
      : this.systemPrompt;
    // Estimate system prompt tokens (minus summary which is tracked separately)
    const summaryAdditionChars = prepared.systemAdditions.join("\n\n").length;
    prepared.stats.systemPromptTokens = estimateTextTokens(effectiveSystemPrompt) - (summaryAdditionChars > 0 ? Math.ceil(summaryAdditionChars / 3.3) : 0);

    const system = buildSystemMessage(effectiveSystemPrompt, this.config);
    const messages = addCacheBreakpoints(prepared.messages, this.config);

    return {
      system,
      messages,
      stats: prepared.stats,
    };
  }

  // Media resolution is handled by media middleware at model call time

  async handleMessage(
    userMessage: string,
    onEvent: StreamHandler,
    attachments?: Attachment[],
  ): Promise<string> {
    // Signal that we're processing
    onEvent({ type: "thinking" });

    // Reload system prompt (picks up new daily notes, summaries, knowledge changes)
    this.systemPrompt = await loadSystemPrompt(this.agentDir, this.config, this.memoryDB);

    // Add user message to session
    const preview = userMessage.slice(0, 80).replace(/\n/g, " ");
    log("runtime", `handleMessage: ${preview}${userMessage.length > 80 ? "..." : ""}${attachments?.length ? ` +${attachments.length} attachment(s)` : ""}`);

    // Save attachments to disk and build SDK-native content
    let userMsg: ModelMessage;
    if (attachments && attachments.length > 0) {
      const mediaRefs: Awaited<ReturnType<typeof saveMedia>>[] = [];
      for (const att of attachments) {
        const ref = saveMedia(this.agentDir, att.data, att.mimeType, att.filename);
        log("runtime", `saved media: ${ref.uri} (${ref.size} bytes)`);
        // Record in sidecar
        if (this.mediaSidecar) {
          this.mediaSidecar.append({
            file: ref.file,
            originalName: att.filename,
            mimeType: ref.mimeType,
            size: ref.size,
            timestamp: new Date().toISOString(),
          });
          // Digest at ingest time (vision call for images, etc.)
          if (this.config.mediaDigest) {
            await digestMediaAtIngest(this.mediaSidecar, this.agentDir, ref.file, ref.mimeType, this.config);
          }
        }
        mediaRefs.push(ref);
      }
      userMsg = { role: "user", content: buildUserContent(userMessage, mediaRefs) };
    } else {
      userMsg = { role: "user", content: userMessage };
    }
    await this.session.append([userMsg]);
    incrementMessageCount();

    // Build tools from scope
    const tools: Record<string, any> = {};
    for (const name of getToolsForScope(this.config.toolScope)) {
      if (name in allTools) {
        tools[name] = allTools[name as ToolName];
      }
    }

    const model = createModel(this.config);
    let streamError: any = null;

    try {
      let fullText = "";

      const allMessages = this.session.getMessages();
      const sessionId = this.session.getSessionId() || undefined;
      const { system: systemMessage, messages: contextWindow, stats } = this.buildPromptContext({
        messages: allMessages,
        sessionId,
      });
      const trimmedCount = stats.totalMessages - stats.windowMessages + (stats.summaryTokens > 0 ? 1 : 0);
      if (trimmedCount > 0) {
        log("context", `trimmed: ${trimmedCount} old messages excluded${stats.summaryTokens > 0 ? `, summary injected (~${stats.summaryTokens} tokens)` : ''}`);
      }

      const { messages: contextMessages, recall } = await injectRecall(
        contextWindow, userMessage, this.recallIndex, trimmedCount, this.config.autoRecall,
      );
      if (recall) {
        onEvent({ type: "recall", recall });
      }

      // Resolve kern-media:// refs before model call (SDK validates URLs before middleware runs)
      const resolvedMessages = this.mediaSidecar
        ? await resolveMediaInMessages(contextMessages, this.mediaSidecar, this.agentDir, this.config)
        : contextMessages;

      log.debug("context", `${resolvedMessages.length} messages, ~${stats.windowTokens} tokens`);
      if (resolvedMessages.length > 0) {
        const first = resolvedMessages[0];
        const last = resolvedMessages[resolvedMessages.length - 1];
        log.debug("context", `first msg: role=${first.role}, last msg: role=${last.role}`);
      }

      const pendingInjections = this.pendingInjections;
      let persistedCount = 0;

      const result = streamText({
        model,
        system: systemMessage,
        messages: resolvedMessages,
        tools,
        stopWhen: stepCountIs(this.config.maxSteps),
        onError: ({ error }) => {
          streamError = error;
          log.error("runtime", `streamText error: ${error}`);
        },
        onStepFinish: async (step) => {
          // Persist only new messages from this step (response.messages is cumulative)
          const allMsgs = step.response.messages as ModelMessage[];
          const newMsgs = allMsgs.slice(persistedCount).map((msg) => {
            if (msg.role === "assistant" && typeof msg.content === "string") {
              return { ...msg, content: msg.content.replace(/^\n+/, "") };
            }
            if (msg.role === "assistant" && Array.isArray(msg.content)) {
              return { ...msg, content: msg.content.map((part: any) =>
                part.type === "text" ? { ...part, text: part.text.replace(/^\n+/, "") } : part
              )};
            }
            return msg;
          });
          if (newMsgs.length > 0) {
            await this.session.append(newMsgs);
            persistedCount = allMsgs.length;
            log("runtime", `step ${step.stepNumber} persisted ${newMsgs.length} new message(s)`);
          }
        },
        prepareStep: ({ messages, stepNumber }) => {
          if (stepNumber === 0 || !pendingInjections) return {};

          const injections = pendingInjections();
          if (injections.length === 0) return {};

          log("runtime", `prepareStep: injecting ${injections.length} same-channel message(s) at step ${stepNumber}`);

          // Inject pending same-channel messages wrapped in <system-reminder>
          const injectedMessages = injections.map((msg) => {
            const text = typeof msg.content === "string" ? msg.content : extractText(msg.content);
            return {
              role: "user" as const,
              content: `<system-reminder>\nThe user sent a new message while you were working:\n${text}\n\nPlease address this message and continue with your tasks.\n</system-reminder>`,
            };
          });

          // Append to session so they persist
          for (const msg of injections) {
            this.session.append([{ role: "user", content: msg.content }]);
          }

          return {
            messages: [...messages, ...injectedMessages],
          };
        },
      });

      let textStarted = false;
      for await (const part of result.fullStream) {
        if (part.type === "text-delta") {
          let text = ("delta" in part ? part.delta : (part as any).text) || "";
          if (!textStarted) {
            text = text.replace(/^\n+/, "");
            if (!text) continue;
            textStarted = true;
          }
          fullText += text;
          onEvent({ type: "text-delta", text });
        } else if (part.type === "tool-call") {
          const args = ("args" in part ? part.args : part.input) as Record<string, unknown>;
          let detail = String(args.path || args.command || args.pattern || args.url || args.action || args.userId || args.query || args.file || "");
          // Enrich detail for tools with extra display-worthy params
          if (args.pages) detail += ` pages:${args.pages}`;
          if (args.prompt && (part.toolName === "pdf" || part.toolName === "image")) detail += ` "${String(args.prompt).slice(0, 60)}"`;
          if (args.offset) detail += ` +${args.offset}`;
          if (args.limit && args.limit !== 2000) detail += ` limit:${args.limit}`;
          onEvent({ type: "tool-call", toolName: part.toolName, toolDetail: detail, toolInput: args });
        } else if (part.type === "tool-result") {
          const output = (part as any).output;
          const resultText = typeof output === "string" ? output : JSON.stringify(output);
          onEvent({ type: "tool-result", toolName: part.toolName, toolResult: resultText });
        }
      }

      log("runtime", `stream finished, text length: ${fullText.length}`);

      // If the stream had an error and produced no output, throw to hit error handler
      if (streamError && fullText.length === 0) {
        throw streamError;
      }

      try {
        const usage = await result.totalUsage;
        const cacheRead = usage.inputTokenDetails?.cacheReadTokens || 0;
        const cacheWrite = usage.inputTokenDetails?.cacheWriteTokens || 0;
        const inputTotal = usage.inputTokens || 0;
        addTokenUsage(inputTotal, usage.outputTokens || 0, cacheRead, cacheWrite);
        if (cacheRead || cacheWrite) {
          const pct = inputTotal > 0 ? Math.round(cacheRead / inputTotal * 100) : 0;
          log("runtime", `cache: ${cacheRead} read, ${cacheWrite} written (${pct}% hit rate, ${inputTotal} total input)`);
        }
      } catch {
        // usage tracking failed — non-critical
      }

      onEvent({ type: "finish", text: fullText });

      return fullText || "(no text response)";
    } catch (error: any) {
      // Extract a useful error message from nested errors
      const realError = streamError || error;
      const lastErr = realError.lastError || realError;
      const cause = lastErr?.cause || realError.cause;
      const status = lastErr?.statusCode || lastErr?.data?.error?.code;
      const rawApiMsg = lastErr?.data?.error?.message || lastErr?.responseBody;
      // Strip HTML error pages (e.g. 502 Bad Gateway) to a clean message
      const apiMsg = typeof rawApiMsg === "string" && rawApiMsg.includes("<html")
        ? `HTTP error ${status || "unknown"} — provider returned an error page`
        : rawApiMsg;
      let msg: string;
      if (cause?.code === "EAI_AGAIN" || cause?.code === "ENOTFOUND") {
        msg = "DNS resolution failed — check network connection";
      } else if (status === 429 || apiMsg?.includes("rate limit")) {
        msg = "Rate limit hit — wait a moment and try again";
      } else if (status === 402 || apiMsg?.includes("credit") || apiMsg?.includes("insufficient")) {
        msg = "API credits exhausted — check your OpenRouter/provider balance";
      } else if (status === 401 || status === 403) {
        msg = "API authentication failed — check your API key in .kern/.env";
      } else if (status === 502) {
        msg = "Provider returned 502 Bad Gateway — the upstream model may be temporarily unavailable";
      } else if (apiMsg) {
        msg = apiMsg;
      } else if (lastErr?.message && !lastErr.message.includes("No output generated")) {
        const rawMsg = lastErr.message;
        msg = typeof rawMsg === "string" && rawMsg.includes("<html")
          ? `HTTP error ${status || "unknown"} — provider returned an error page`
          : rawMsg;
      } else if (error.message?.includes("No output generated")) {
        msg = `No response from model (Original error: ${cause?.message || cause || lastErr?.message || "None"})`;
      } else {
        msg = error.message || "Unknown error";
      }
      onEvent({ type: "error", error: msg });
      throw new Error(msg);
    }
  }


  getSessionId(): string | null {
    return this.session.getSessionId();
  }

  async getSystemPrompt(): Promise<string> {
    this.systemPrompt = await loadSystemPrompt(this.agentDir, this.config, this.memoryDB);
    return this.systemPrompt;
  }

  getMessages(): ModelMessage[] {
    return this.session.getMessages();
  }
}
