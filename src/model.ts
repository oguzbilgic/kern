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
      const headers = {
        "HTTP-Referer": "https://github.com/oguzbilgic/kern-ai",
        "X-Title": "kern-ai",
        "X-OpenRouter-Categories": "cli-agent,personal-agent",
      };
      // Use OpenRouter-native provider for Anthropic models (prompt caching support),
      // generic OpenAI-compatible provider for everything else (more reliable streaming)
      if (config.model.startsWith("anthropic/")) {
        const openrouter = createOpenRouter({
          apiKey: process.env.OPENROUTER_API_KEY,
          headers,
        });
        return openrouter.chat(config.model);
      }
      const openai = createOpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: process.env.OPENROUTER_API_KEY,
        headers,
      });
      // Force chat completions API — default openai() uses Responses API
      // for newer models (gpt-5.x, o3, etc.) which OpenRouter doesn't support
      return openai.chat(config.model);
    }
    case "openai": {
      const openai = createOpenAI();
      return openai(config.model);
    }
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}
