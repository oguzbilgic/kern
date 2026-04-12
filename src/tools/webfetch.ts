import { tool } from "ai";
import { z } from "zod";
import { log } from "../log.js";
import { htmlToMarkdown } from "../util.js";

async function fetchViaJina(url: string): Promise<string> {
  const headers: Record<string, string> = {
    Accept: "text/plain",
  };
  const apiKey = process.env.JINA_API_KEY;
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const response = await fetch(`https://r.jina.ai/${encodeURIComponent(url)}`, {
    headers,
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`Jina HTTP ${response.status} ${response.statusText}`);
  }

  return await response.text();
}

async function fetchDirect(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "kern-ai/0.1",
      Accept: "text/html,application/json,text/plain,*/*",
    },
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();

  if (contentType.includes("text/html")) {
    return htmlToMarkdown(text);
  }
  return text;
}

export const webfetchTool = tool({
  description:
    "Fetch content from a URL. HTML pages are converted to markdown by default. JSON and plain text are returned as-is. Useful for reading web pages, APIs, documentation.",
  inputSchema: z.object({
    url: z.string().describe("The URL to fetch"),
    raw: z
      .boolean()
      .optional()
      .describe(
        "Return raw HTML instead of converting to markdown (default: false)"
      ),
  }),
  execute: async ({ url, raw = false }) => {
    // Raw mode: direct fetch, no conversion
    if (raw) {
      try {
        const response = await fetch(url, {
          headers: {
            "User-Agent": "kern-ai/0.1",
            Accept: "text/html,application/json,text/plain,*/*",
          },
          signal: AbortSignal.timeout(30000),
        });
        if (!response.ok) {
          return `Error: HTTP ${response.status} ${response.statusText}`;
        }
        const text = await response.text();
        return truncate(text);
      } catch (e: any) {
        if (e.name === "TimeoutError" || e.name === "AbortError") {
          return `Error: request timed out after 30s`;
        }
        return `Error: ${e.message}`;
      }
    }

    // Check if URL returns JSON/plain text (skip markdown conversion)
    try {
      const probe = await fetch(url, {
        method: "HEAD",
        headers: { "User-Agent": "kern-ai/0.1" },
        signal: AbortSignal.timeout(5000),
      });
      const contentType = probe.headers.get("content-type") || "";
      if (
        contentType.includes("application/json") ||
        (contentType.includes("text/plain") && !contentType.includes("text/html"))
      ) {
        return await fetchDirect(url);
      }
    } catch {
      // HEAD failed, continue with provider chain
    }

    // Provider chain: Jina → Turndown fallback
    try {
      const result = await fetchViaJina(url);
      return truncate(result);
    } catch (e: any) {
      log.warn("webfetch", `Jina failed for ${url}: ${e.message}, falling back to direct fetch`);
    }

    try {
      const result = await fetchDirect(url);
      return truncate(result);
    } catch (e: any) {
      if (e.name === "TimeoutError" || e.name === "AbortError") {
        return `Error: request timed out after 30s`;
      }
      return `Error: ${e.message}`;
    }
  },
});

function truncate(text: string): string {
  if (text.length > 50000) {
    return text.slice(0, 50000) + `\n...(truncated, ${text.length} chars total)`;
  }
  return text;
}
