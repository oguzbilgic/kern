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

function trimToTokenBudget(messages: ModelMessage[], maxTokens: number): ModelMessage[] {
  if (maxTokens <= 0) return messages;
  const total = estimateTokens(messages);
  if (total <= maxTokens) return messages;

  // Trim from front until under budget
  // Skip tool-result and assistant messages that follow tool calls to keep pairs intact
  let trimmed = [...messages];
  while (trimmed.length > 1 && estimateTokens(trimmed) > maxTokens) {
    trimmed.shift();
    // Keep shifting if we landed on a tool role or assistant with tool content
    // to avoid orphaned tool-results
    while (trimmed.length > 1 && trimmed[0].role === "tool") {
      trimmed.shift();
    }
  }
  // Ensure we start with a user message
  while (trimmed.length > 1 && trimmed[0].role !== "user") {
    trimmed.shift();
  }
  return trimmed;
}
import { initKernTool, incrementMessageCount, addTokenUsage } from "./tools/kern.js";

export interface StreamEvent {
  type: "text-delta" | "tool-call" | "tool-result" | "finish" | "error";
  text?: string;
  toolName?: string;
  toolDetail?: string;
  error?: string;
}

export type StreamHandler = (event: StreamEvent) => void;

export class Runtime {
  private config!: KernConfig;
  private systemPrompt!: string;
  private session!: SessionManager;
  private agentDir: string;

  constructor(agentDir: string) {
    this.agentDir = agentDir;
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

    try {
      let fullText = "";

      // Trim messages to fit context window
      const allMessages = this.session.getMessages();
      const contextMessages = trimToTokenBudget(allMessages, this.config.maxContextTokens);
      if (contextMessages.length < allMessages.length) {
        const trimmed = allMessages.length - contextMessages.length;
        log("runtime", `context trimmed: ${trimmed} old messages excluded`);
      }

      const pendingInjections = this.pendingInjections;

      const result = streamText({
        model,
        system: this.systemPrompt,
        messages: contextMessages,
        tools,
        stopWhen: stepCountIs(this.config.maxSteps),
        onError: () => {},
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

      for await (const part of result.fullStream) {
        if (part.type === "text-delta") {
          const text = ("delta" in part ? part.delta : (part as any).text) || "";
          fullText += text;
          onEvent({ type: "text-delta", text });
        } else if (part.type === "tool-call") {
          const args = ("args" in part ? part.args : part.input) as Record<string, unknown>;
          const detail = String(args.path || args.command || args.pattern || args.url || args.action || "");
          onEvent({ type: "tool-call", toolName: part.toolName, toolDetail: detail });
        } else if (part.type === "tool-result") {
          onEvent({ type: "tool-result" });
        }
      }

      log("runtime", `stream finished, text length: ${fullText.length}`);

      const response = await result.response;
      await this.session.append(response.messages as ModelMessage[]);

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
      const lastErr = error.lastError || error;
      const cause = lastErr?.cause || error.cause;
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
        msg = "No response from model — likely a network or API error, try again";
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
