import { streamText, type ModelMessage, stepCountIs } from "ai";
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
import { prepareContext, injectRecall, loadSystemPrompt, type PrepareContextOptions } from "./context.js";
import type { Attachment } from "./interfaces/types.js";
import { saveMedia, loadMedia, type MediaRef } from "./media.js";
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
    return {
      system: effectiveSystemPrompt,
      messages: prepared.messages,
      stats: prepared.stats,
    };
  }

  /**
   * Parse media ref markers in user messages and replace with multimodal content.
   * Session stores: "[media: image .kern/media/abc123.jpg image/jpeg "photo.jpg" 12345b]\nHere's my screenshot"
   * Model receives: [{ type: "image", image: Buffer, mimeType }, { type: "text", text: "Here's my screenshot" }]
   */
  private resolveMediaRefs(messages: ModelMessage[]): ModelMessage[] {
    const MEDIA_REF_RE = /^\[media: (image|audio|video|document) ([^\s]+) ([^\s]+)(?:\s+"([^"]*)")?\s+(\d+)b\]$/;

    return messages.map((msg) => {
      if (msg.role !== "user" || typeof msg.content !== "string") return msg;

      const lines = msg.content.split("\n");
      const mediaLines: { type: string; path: string; mimeType: string; filename?: string }[] = [];
      const textLines: string[] = [];

      for (const line of lines) {
        const match = line.match(MEDIA_REF_RE);
        if (match) {
          mediaLines.push({
            type: match[1],
            path: match[2],
            mimeType: match[3],
            filename: match[4] || undefined,
          });
        } else {
          textLines.push(line);
        }
      }

      if (mediaLines.length === 0) return msg;

      // Build multimodal content parts
      const contentParts: any[] = [];
      for (const ref of mediaLines) {
        if (ref.type === "image") {
          const data = loadMedia(this.agentDir, ref as MediaRef);
          if (data) {
            contentParts.push({ type: "image", image: data, mimeType: ref.mimeType });
          } else {
            contentParts.push({ type: "text", text: `[Image unavailable: ${ref.path}]` });
          }
        } else {
          const label = ref.filename || `${ref.type} file`;
          contentParts.push({ type: "text", text: `[Attached ${ref.type}: ${label} (${ref.mimeType})]` });
        }
      }

      const text = textLines.join("\n").trim();
      if (text) {
        contentParts.push({ type: "text", text });
      }

      return { ...msg, content: contentParts };
    });
  }

  async handleMessage(
    userMessage: string,
    onEvent: StreamHandler,
    attachments?: Attachment[],
  ): Promise<string> {
    // Reload system prompt (picks up new daily notes, summaries, knowledge changes)
    this.systemPrompt = await loadSystemPrompt(this.agentDir, this.config, this.memoryDB);

    // Add user message to session
    const preview = userMessage.slice(0, 80).replace(/\n/g, " ");
    log("runtime", `handleMessage: ${preview}${userMessage.length > 80 ? "..." : ""}${attachments?.length ? ` +${attachments.length} attachment(s)` : ""}`);

    // Save attachments to disk and build session message with media refs
    let userMsg: ModelMessage;
    if (attachments && attachments.length > 0) {
      const mediaRefs: MediaRef[] = [];
      for (const att of attachments) {
        const ref = saveMedia(this.agentDir, att.data, att.type, att.mimeType, att.filename);
        mediaRefs.push(ref);
        log("runtime", `saved ${att.type}: ${ref.path} (${att.size} bytes)`);
      }
      // Store as text with embedded media ref markers — session gets paths, not buffers
      // Format: text content + JSON media refs that can be parsed back at model call time
      const mediaBlock = mediaRefs.map(r =>
        `[media: ${r.type} ${r.path} ${r.mimeType}${r.filename ? ` "${r.filename}"` : ""} ${r.size}b]`
      ).join("\n");
      const textContent = userMessage
        ? `${mediaBlock}\n${userMessage}`
        : mediaBlock;
      userMsg = { role: "user", content: textContent };
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
      const { system: effectiveSystemPrompt, messages: contextWindow, stats } = this.buildPromptContext({
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

      // Resolve media refs in messages → multimodal content for model
      const modelMessages = this.resolveMediaRefs(contextMessages);

      log.debug("context", `${modelMessages.length} messages, ~${stats.windowTokens} tokens`);
      if (modelMessages.length > 0) {
        const first = modelMessages[0];
        const last = modelMessages[modelMessages.length - 1];
        log.debug("context", `first msg: role=${first.role}, last msg: role=${last.role}`);
      }

      const pendingInjections = this.pendingInjections;
      let persistedCount = 0;

      const result = streamText({
        model,
        system: effectiveSystemPrompt,
        messages: modelMessages,
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
