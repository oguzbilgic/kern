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
  type: "text-delta" | "tool-call" | "tool-result" | "finish" | "error" | "recall" | "thinking" | "render";
  text?: string;
  toolName?: string;
  toolDetail?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: string;
  error?: string;
  recall?: { query: string; chunks: number; tokens: number; results: Array<{ timestamp: string; text: string; distance: number }> };
  render?: { html: string; dashboard?: string | null; target: string; title: string };
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

  /** Plugin hook — called on each tool result for custom event emission */
  onToolResult: ((toolName: string, result: string, emit: (event: StreamEvent) => void) => void) | null = null;

  /** Additional tools registered by plugins */
  private pluginTools: Record<string, any> = {};

  constructor(agentDir: string) {
    this.agentDir = agentDir;
  }

  addTools(tools: Record<string, any>) {
    Object.assign(this.pluginTools, tools);
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

    // Build tools from scope + plugins
    const tools: Record<string, any> = {};
    for (const name of getToolsForScope(this.config.toolScope)) {
      if (name in allTools) {
        tools[name] = allTools[name as ToolName];
      }
    }
    // Plugin tools are always included (not gated by scope)
    Object.assign(tools, this.pluginTools);

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
      // Accumulate mid-turn injections so they persist across all subsequent steps
      const midTurnMessages: { role: "user"; content: string }[] = [];

      const result = streamText({
        model,
        system: systemMessage,
        messages: resolvedMessages,
        tools,
        stopWhen: stepCountIs(this.config.maxSteps),
        onError: ({ error }) => {
          streamError = error;
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

          // Collect new injections and add to persistent mid-turn list
          const injections = pendingInjections();
          for (const msg of injections) {
            const text = typeof msg.content === "string" ? msg.content : extractText(msg.content);
            midTurnMessages.push({ role: "user" as const, content: text });
            // Persist to session JSONL
            this.session.append([{ role: "user", content: msg.content }]);
          }

          if (midTurnMessages.length === 0) return {};

          log("runtime", `prepareStep: injecting ${midTurnMessages.length} mid-turn message(s) at step ${stepNumber}`);

          return {
            messages: [...messages, ...midTurnMessages],
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

          // Dispatch to plugins for custom event emission
          if (this.onToolResult) {
            this.onToolResult(part.toolName, resultText, onEvent);
          }
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
      const { message: msg, category } = parseProviderError(streamError, error);
      log.error("runtime", `[${category}] ${msg}`);
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

/** Clean error categorization from provider error chains */
function parseProviderError(
  streamError: unknown,
  caughtError: any
): { message: string; category: string } {
  const realError: any = streamError || caughtError;
  const lastErr = realError?.lastError || realError;
  const cause: any = lastErr?.cause || realError?.cause;
  const status = lastErr?.statusCode || lastErr?.data?.error?.code;
  const rawApiMsg = lastErr?.data?.error?.message || lastErr?.responseBody;

  // Detect HTML error pages
  const isHtml = (s: unknown): boolean =>
    typeof s === "string" && s.includes("<html");

  const apiMsg = isHtml(rawApiMsg)
    ? null // discard HTML, fall through to status-based matching
    : rawApiMsg;

  // Priority-ordered matchers: first match wins
  const matchers: Array<{
    test: () => boolean;
    category: string;
    message: string;
  }> = [
    {
      test: () => cause?.code === "EAI_AGAIN" || cause?.code === "ENOTFOUND",
      category: "network",
      message: "DNS resolution failed — check network connection",
    },
    {
      test: () => status === 401 || status === 403,
      category: "auth",
      message: "API authentication failed — check your API key in .kern/.env",
    },
    {
      test: () => status === 429 || apiMsg?.includes?.("rate limit"),
      category: "rate_limit",
      message: "Rate limit hit — wait a moment and try again",
    },
    {
      test: () =>
        status === 402 ||
        apiMsg?.includes?.("credit") ||
        apiMsg?.includes?.("insufficient"),
      category: "billing",
      message:
        "API credits exhausted — check your OpenRouter/provider balance",
    },
    {
      test: () => status === 502 || isHtml(rawApiMsg),
      category: "provider",
      message:
        "Provider returned 502 Bad Gateway — the upstream model may be temporarily unavailable",
    },
    {
      test: () => !!apiMsg,
      category: "provider",
      message: apiMsg,
    },
    {
      test: () =>
        !!lastErr?.message &&
        !lastErr.message.includes("No output generated") &&
        !isHtml(lastErr.message),
      category: "provider",
      message: lastErr?.message,
    },
    {
      test: () => caughtError?.message?.includes?.("No output generated"),
      category: "no_output",
      message: `No response from model (${cause?.message || cause || lastErr?.message || "unknown cause"})`,
    },
  ];

  for (const m of matchers) {
    if (m.test()) return { message: m.message, category: m.category };
  }

  return {
    message: caughtError?.message || "Unknown error",
    category: "unknown",
  };
}
