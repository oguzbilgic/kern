import { streamText, type ModelMessage, stepCountIs } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { allTools, type ToolName } from "./tools/index.js";
import { SessionManager } from "./session.js";
import { loadConfig, loadSystemPrompt, getToolsForScope, type KernConfig } from "./config.js";
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

  async init(): Promise<void> {
    this.config = await loadConfig(this.agentDir);
    this.systemPrompt = await loadSystemPrompt(this.agentDir, this.config);
    this.session = new SessionManager(this.agentDir);
    await this.session.init();
    await this.session.load();

    await initKernTool({
      agentDir: this.agentDir,
      config: this.config,
      sessionId: this.session.getSessionId() || "unknown",
    });
  }

  async handleMessage(
    userMessage: string,
    onEvent: StreamHandler,
  ): Promise<string> {
    // Add user message to session
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

      const result = streamText({
        model,
        system: this.systemPrompt,
        messages: this.session.getMessages(),
        tools,
        stopWhen: stepCountIs(this.config.maxSteps),
        onError: () => {},
      });

      for await (const part of result.fullStream) {
        if (part.type === "text-delta") {
          fullText += part.text;
          onEvent({ type: "text-delta", text: part.text });
        } else if (part.type === "tool-call") {
          const args = ("args" in part ? part.args : part.input) as Record<string, unknown>;
          const detail = String(args.path || args.command || args.pattern || args.url || "");
          onEvent({ type: "tool-call", toolName: part.toolName, toolDetail: detail });
        } else if (part.type === "tool-result") {
          onEvent({ type: "tool-result" });
        }
      }

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
      const cause = error.lastError?.cause || error.cause;
      let msg: string;
      if (cause?.code === "EAI_AGAIN" || cause?.code === "ENOTFOUND") {
        msg = "DNS resolution failed — check network connection";
      } else if (error.lastError?.message) {
        msg = error.lastError.message;
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
