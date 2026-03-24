import { streamText, type ModelMessage, stepCountIs } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { allTools, type ToolName } from "./tools/index.js";
import { SessionManager } from "./session.js";
import { loadConfig, loadSystemPrompt, type KernConfig } from "./config.js";

export interface StreamCallbacks {
  onText: (text: string) => void;
  onStepFinish?: (stepText: string) => void;
  onFinish: (fullText: string) => void;
  onError: (error: Error) => void;
}

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
    this.systemPrompt = await loadSystemPrompt(this.agentDir);
    this.session = new SessionManager(this.agentDir);
    await this.session.init();
    await this.session.load();
  }

  async handleMessage(
    userMessage: string,
    callbacks: StreamCallbacks,
  ): Promise<string> {
    // Add user message to session
    const userMsg: ModelMessage = { role: "user", content: userMessage };
    await this.session.append([userMsg]);

    // Build tools from config
    const tools: Record<string, any> = {};
    for (const name of this.config.tools) {
      if (name in allTools) {
        tools[name] = allTools[name as ToolName];
      }
    }

    // Create provider
    const model = this.createModel();

    try {
      let fullText = "";

      const result = streamText({
        model,
        system: this.systemPrompt,
        messages: this.session.getMessages(),
        tools,
        stopWhen: stepCountIs(this.config.maxSteps),
        onError: ({ error }) => {
          console.error("[kern] stream error:", error);
        },
      });

      for await (const part of result.fullStream) {
        if (part.type === "text-delta") {
          fullText += part.text;
          callbacks.onText(fullText);
        } else if (part.type === "tool-call") {
          console.error(`[kern] tool: ${part.toolName}`);
        } else if (part.type === "error") {
          console.error("[kern] error:", part.error);
        }
      }

      // Consume the stream fully and get response messages
      const response = await result.response;
      await this.session.append(response.messages as ModelMessage[]);

      callbacks.onFinish(fullText);
      return fullText || "(no text response)";
    } catch (error: any) {
      callbacks.onError(error);
      throw error;
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
}
