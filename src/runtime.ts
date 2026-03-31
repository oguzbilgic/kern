import { streamText, type ModelMessage, stepCountIs } from "ai";
import { log } from "./log.js";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { allTools, type ToolName } from "./tools/index.js";
import { SessionManager } from "./session.js";
import { loadConfig, loadSystemPrompt, getToolsForScope, type KernConfig } from "./config.js";

// Token estimate: stringify everything, ~4 chars per token
function estimateTokens(messages: ModelMessage[]): number {
  let chars = 0;
  for (const msg of messages) {
    chars += JSON.stringify(msg).length;
  }
  return Math.ceil(chars / 4);
}

// Per-message token size cache
const msgSizeCache = new WeakMap<ModelMessage, number>();

function getMsgSize(msg: ModelMessage): number {
  let size = msgSizeCache.get(msg);
  if (size === undefined) {
    size = Math.ceil(JSON.stringify(msg).length / 4);
    msgSizeCache.set(msg, size);
  }
  return size;
}

function trimToTokenBudget(messages: ModelMessage[], maxTokens: number): ModelMessage[] {
  if (maxTokens <= 0) return messages;

  // Compute total using cached per-message sizes
  let total = 0;
  for (const msg of messages) {
    total += getMsgSize(msg);
  }
  if (total <= maxTokens) return messages;

  // Find cut point from the front
  let cutTotal = total;
  let cutIndex = 0;
  while (cutIndex < messages.length - 1 && cutTotal > maxTokens) {
    cutTotal -= getMsgSize(messages[cutIndex]);
    cutIndex++;
  }

  // Adjust: skip orphaned tool messages
  while (cutIndex < messages.length - 1 && messages[cutIndex].role === "tool") {
    cutIndex++;
  }
  // Ensure we start with a user message
  while (cutIndex < messages.length - 1 && messages[cutIndex].role !== "user") {
    cutIndex++;
  }

  return messages.slice(cutIndex);
}
import { initKernTool, incrementMessageCount, addTokenUsage } from "./tools/kern.js";
import type { RecallIndex } from "./recall.js";

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

  constructor(agentDir: string) {
    this.agentDir = agentDir;
  }

  setRecallIndex(index: RecallIndex) {
    this.recallIndex = index;
  }

  async setPairingManager(pairing: any): Promise<void> {
    const { initKernTool } = await import("./tools/kern.js");
    const session = this.session;
    const config = this.config;
    await initKernTool({
      agentDir: this.agentDir,
      config: this.config,
      sessionId: this.session.getSessionId() || "unknown",
      getSessionStats: () => {
        const allMessages = session.getMessages();
        const totalTokens = estimateTokens(allMessages);
        const windowMessages = trimToTokenBudget(allMessages, config.maxContextTokens);
        const windowTokens = estimateTokens(windowMessages);
        return {
          totalMessages: allMessages.length,
          estimatedTokens: totalTokens,
          windowTokens,
        };
      },
      pairingManager: pairing,
    });
  }

  async init(): Promise<void> {
    this.config = await loadConfig(this.agentDir);
    this.systemPrompt = await loadSystemPrompt(this.agentDir, this.config);
    this.session = new SessionManager(this.agentDir);
    await this.session.init();
    await this.session.load();

    const session = this.session;
    const config = this.config;
    await initKernTool({
      agentDir: this.agentDir,
      config: this.config,
      sessionId: this.session.getSessionId() || "unknown",
      getSessionStats: () => {
        const allMessages = session.getMessages();
        const totalTokens = estimateTokens(allMessages);
        const windowMessages = trimToTokenBudget(allMessages, config.maxContextTokens);
        const windowTokens = estimateTokens(windowMessages);
        return {
          totalMessages: allMessages.length,
          estimatedTokens: totalTokens,
          windowTokens,
        };
      },
    });
  }

  // Pending messages to inject via prepareStep
  private pendingInjections: (() => { role: string; content: string }[]) | null = null;

  setPendingInjections(fn: () => { role: string; content: string }[]) {
    this.pendingInjections = fn;
  }

  async handleMessage(
    userMessage: string,
    onEvent: StreamHandler,
  ): Promise<string> {
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

    const model = this.createModel();
    let streamError: any = null;

    try {
      let fullText = "";

      // Trim messages to fit context window
      const allMessages = this.session.getMessages();
      let contextMessages = trimToTokenBudget(allMessages, this.config.maxContextTokens);
      const trimmedCount = allMessages.length - contextMessages.length;
      if (trimmedCount > 0) {
        log("runtime", `context trimmed: ${trimmedCount} old messages excluded`);
      }

      // Auto-recall: inject relevant old context when messages have been trimmed
      if (trimmedCount > 0 && this.recallIndex && this.config.autoRecall) {
        try {
          const results = await this.recallIndex.search(userMessage, 3);
          // Filter: distance threshold + skip chunks already in context window
          const contextStart = trimmedCount; // messages before this index were trimmed
          const relevant = results.filter(r => r.distance < 0.95 && r.msg_end < contextStart);
          if (relevant.length > 0) {
            const recallText = relevant
              .map(r => `[${r.timestamp}]\n${r.text}`)
              .join("\n---\n");
            const recallMsg: ModelMessage = {
              role: "user",
              content: `<recall>\nRelevant context from past conversations:\n${recallText}\n</recall>`,
            };
            // Budget: only inject if it fits within ~2000 tokens
            const recallTokens = getMsgSize(recallMsg);
            if (recallTokens <= 2000) {
              contextMessages = [recallMsg, ...contextMessages];
              log("recall", `auto-recall: injected ${relevant.length} chunks (~${recallTokens} tokens)`);
              onEvent({
                type: "recall",
                recall: {
                  query: userMessage,
                  chunks: relevant.length,
                  tokens: recallTokens,
                  results: relevant.map(r => ({ timestamp: r.timestamp, text: r.text, distance: r.distance })),
                },
              });
            }
          }
        } catch (err: any) {
          log("recall", `auto-recall failed: ${err.message}`);
        }
      }

      log("runtime", `context: ${contextMessages.length} messages, ~${estimateTokens(contextMessages)} tokens`);
      if (contextMessages.length > 0) {
        const first = contextMessages[0];
        const last = contextMessages[contextMessages.length - 1];
        log("runtime", `first msg: role=${first.role}, last msg: role=${last.role}`);
      }

      const pendingInjections = this.pendingInjections;
      let persistedCount = 0;

      const result = streamText({
        model,
        system: this.systemPrompt,
        messages: contextMessages,
        tools,
        stopWhen: stepCountIs(this.config.maxSteps),
        onError: ({ error }) => {
          streamError = error;
          log("runtime", `streamText error: ${error}`);
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

  private createModel() {
    switch (this.config.provider) {
      case "anthropic": {
        const anthropic = createAnthropic();
        return anthropic(this.config.model);
      }
      case "openrouter": {
        const openrouter = createOpenAI({
          baseURL: "https://openrouter.ai/api/v1",
          apiKey: process.env.OPENROUTER_API_KEY,
          headers: {
            "HTTP-Referer": "https://github.com/oguzbilgic/kern-ai",
            "X-Title": "kern-ai",
          },
        });
        return openrouter.chat(this.config.model);
      }
      case "openai": {
        const openai = createOpenAI();
        return openai(this.config.model);
      }
      default:
        throw new Error(`Unknown provider: ${this.config.provider}`);
    }
  }

  getSessionId(): string | null {
    return this.session.getSessionId();
  }

  getMessages(): ModelMessage[] {
    return this.session.getMessages();
  }
}
