import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { KernConfig } from "./config.js";

/**
 * Create an AI SDK model instance from kern config.
 * Shared across runtime (chat) and notes (summary generation).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createModel(config: KernConfig): any {
  switch (config.provider) {
    case "anthropic": {
      const anthropic = createAnthropic();
      return anthropic(config.model);
    }
    case "openrouter": {
      const openrouter = createOpenRouter({
        apiKey: process.env.OPENROUTER_API_KEY,
        headers: {
          "HTTP-Referer": "https://github.com/oguzbilgic/kern-ai",
          "X-Title": "kern-ai",
          "X-OpenRouter-Categories": "cli-agent,personal-agent",
        },
      });
      return openrouter.chat(config.model);
    }
    case "openai": {
      const openai = createOpenAI();
      return openai(config.model);
    }
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}
