import { streamText, type ModelMessage, stepCountIs } from "ai";
import { log } from "./log.js";
import { createModel } from "./model.js";
import { allTools, type ToolName } from "./tools/index.js";
import { SessionManager } from "./session.js";
import { loadConfig, getToolsForScope, type KernConfig } from "./config.js";
import { initKernTool, incrementMessageCount, addTokenUsage } from "./tools/kern.js";
import type { RecallIndex } from "./recall.js";
import type { SegmentIndex } from "./segments.js";
import type { MemoryDB } from "./memory.js";
import { prepareContext, injectRecall, loadSystemPrompt, type PrepareContextOptions } from "./context.js";
export type { SessionStats } from "./context.js";



export interface StreamEvent {
  type: "text-delta" | "tool-call" | "tool-result" | "finish" | "error" | "recall";
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

  async setPairingManager(pairing: any): Promise<void> {
    const { initKernTool } = await import("./tools/kern.js");
    await initKernTool({
      agentDir: this.agentDir,
      config: this.config,
      sessionId: this.session.getSessionId() || "unknown",
      getSessionStats: () => prepareContext({ messages: this.session.getMessages(), config: this.config, sessionId: this.session.getSessionId() || undefined, segmentIndex: this.segmentIndex }).stats,
      pairingManager: pairing,
    });
  }

  async init(): Promise<void> {
    this.config = await loadConfig(this.agentDir);
    this.systemPrompt = await loadSystemPrompt(this.agentDir, this.config, this.memoryDB);
    this.session = new SessionManager(this.agentDir, this.memoryDB ?? undefined);
    await this.session.init();
    await this.session.load();

    await initKernTool({
      agentDir: this.agentDir,
      config: this.config,
      sessionId: this.session.getSessionId() || "unknown",
      getSessionStats: () => prepareContext({ messages: this.session.getMessages(), config: this.config, sessionId: this.session.getSessionId() || undefined, segmentIndex: this.segmentIndex }).stats,
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
    return {
      system: effectiveSystemPrompt,
      messages: prepared.messages,
      stats: prepared.stats,
    };
  }

  async handleMessage(
    userMessage: string,
    onEvent: StreamHandler,
  ): Promise<string> {
    // Reload system prompt (picks up new daily notes, summaries, knowledge changes)
    this.systemPrompt = await loadSystemPrompt(this.agentDir, this.config, this.memoryDB);

    // Add user message to session
    const preview = userMessage.slice(0, 80).replace(/\n/g, " ");
    log("runtime", `handleMessage: ${preview}${userMessage.length > 80 ? "..." : ""}`);
    const userMsg: ModelMessage = { role: "user", content: userMessage };
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
      const { system: effectiveSystemPrompt, messages: contextWindow, stats } = this.buildPromptContext({
        messages: allMessages,
        sessionId,
      });
      const trimmedCount = stats.totalMessages - stats.windowMessages + (stats.historyTokens > 0 ? 1 : 0);
      if (trimmedCount > 0) {
        log("context", `trimmed: ${trimmedCount} old messages excluded${stats.historyTokens > 0 ? `, history injected (~${stats.historyTokens} tokens)` : ''}`);
      }

      const { messages: contextMessages, recall } = await injectRecall(
        contextWindow, userMessage, this.recallIndex, trimmedCount, this.config.autoRecall,
      );
      if (recall) {
        onEvent({ type: "recall", recall });
      }

      log.debug("context", `${contextMessages.length} messages, ~${stats.windowTokens} tokens`);
      if (contextMessages.length > 0) {
        const first = contextMessages[0];
        const last = contextMessages[contextMessages.length - 1];
        log.debug("context", `first msg: role=${first.role}, last msg: role=${last.role}`);
      }

      const pendingInjections = this.pendingInjections;
      let persistedCount = 0;

      const result = streamText({
        model,
        system: effectiveSystemPrompt,
        messages: contextMessages,
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
          const injectedMessages = injections.map((msg) => ({
            role: "user" as const,
            content: `<system-reminder>\nThe user sent a new message while you were working:\n${msg.content}\n\nPlease address this message and continue with your tasks.\n</system-reminder>`,
          }));

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
          const detail = String(args.path || args.command || args.pattern || args.url || args.action || args.userId || args.query || "");
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
        addTokenUsage(usage.inputTokens || 0, usage.outputTokens || 0);
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
      const apiMsg = lastErr?.data?.error?.message || lastErr?.responseBody;
      let msg: string;
      if (cause?.code === "EAI_AGAIN" || cause?.code === "ENOTFOUND") {
        msg = "DNS resolution failed — check network connection";
      } else if (status === 429 || apiMsg?.includes("rate limit")) {
        msg = "Rate limit hit — wait a moment and try again";
      } else if (status === 402 || apiMsg?.includes("credit") || apiMsg?.includes("insufficient")) {
        msg = "API credits exhausted — check your OpenRouter/provider balance";
      } else if (status === 401 || status === 403) {
        msg = "API authentication failed — check your API key in .kern/.env";
      } else if (apiMsg) {
        msg = apiMsg;
      } else if (lastErr?.message && !lastErr.message.includes("No output generated")) {
        msg = lastErr.message;
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
