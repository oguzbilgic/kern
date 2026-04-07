import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { embed } from "ai";
import type { KernConfig } from "./config.js";

const OPENROUTER_HEADERS = {
  "HTTP-Referer": "https://github.com/oguzbilgic/kern-ai",
  "X-Title": "kern-ai",
  "X-OpenRouter-Categories": "cli-agent,personal-agent",
};

/**
 * Create an OpenAI-compatible client for a given provider.
 * Used by embedding and summary model factories.
 */
function createOpenAIClient(provider: string) {
  switch (provider) {
    case "openai":
      return createOpenAI();
    case "ollama": {
      const base = (process.env.OLLAMA_BASE_URL || "http://localhost:11434").replace(/\/+$/, "");
      return createOpenAI({
        baseURL: `${base}/v1`,
        apiKey: "ollama",
      });
    }
    default: {
      // openrouter, anthropic, or anything else — fall back to OpenRouter
      const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
      if (!apiKey) return null;
      return createOpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey,
        headers: OPENROUTER_HEADERS,
      });
    }
  }
}

/**
 * Create an embedding model for recall and segments.
 * Returns null if no suitable provider/key is available.
 */
export function createEmbeddingModel(provider: string): Parameters<typeof embed>[0]["model"] | null {
  if (provider === "ollama") {
    const client = createOpenAIClient("ollama");
    return client!.embeddingModel("nomic-embed-text");
  }

  // For all other providers, try OpenAI or OpenRouter
  if (provider === "openai") {
    if (!process.env.OPENAI_API_KEY) return null;
    const client = createOpenAI();
    return client.embeddingModel("text-embedding-3-small");
  }

  // openrouter, anthropic, or unknown — try OpenRouter then OpenAI
  const apiKey = process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const client = createOpenAIClient(provider);
  if (!client) return null;
  const modelId = process.env.OPENROUTER_API_KEY
    ? "openai/text-embedding-3-small"
    : "text-embedding-3-small";
  return client.embeddingModel(modelId);
}

/**
 * Create a cheap chat model for segment summarization.
 * Returns null if no suitable provider/key is available.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createSummaryModel(provider: string): any {
  const client = createOpenAIClient(provider);
  if (!client) return null;

  switch (provider) {
    case "openai":
      return client.chat("gpt-4.1-nano");
    case "ollama":
      return client.chat("gemma3:4b");
    default:
      return client.chat("openai/gpt-4.1-mini");
  }
}

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
      // Use OpenRouter-native provider for Anthropic models (prompt caching support),
      // generic OpenAI-compatible provider for everything else (more reliable streaming)
      if (config.model.startsWith("anthropic/")) {
        const openrouter = createOpenRouter({
          apiKey: process.env.OPENROUTER_API_KEY,
          headers: OPENROUTER_HEADERS,
        });
        return openrouter.chat(config.model);
      }
      const openai = createOpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: process.env.OPENROUTER_API_KEY,
        headers: OPENROUTER_HEADERS,
      });
      // Force chat completions API — default openai() uses Responses API
      // for newer models (gpt-5.x, o3, etc.) which OpenRouter doesn't support
      return openai.chat(config.model);
    }
    case "openai": {
      const openai = createOpenAI();
      return openai(config.model);
    }
    case "ollama": {
      const base = (process.env.OLLAMA_BASE_URL || "http://localhost:11434").replace(/\/+$/, "");
      const ollama = createOpenAI({
        baseURL: `${base}/v1`,
        apiKey: "ollama", // required by SDK but ignored by Ollama
      });
      return ollama.chat(config.model);
    }
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}
