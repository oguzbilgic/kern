import { tool } from "ai";
import { z } from "zod";

export const webfetchTool = tool({
  description:
    "Fetch content from a URL. Returns the response body as text. Useful for reading web pages, APIs, documentation.",
  inputSchema: z.object({
    url: z.string().describe("The URL to fetch"),
    timeout: z
      .number()
      .optional()
      .describe("Timeout in milliseconds (default: 30000)"),
  }),
  execute: async ({ url, timeout = 30000 }) => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "kern-ai/0.1",
          "Accept": "text/html,application/json,text/plain,*/*",
        },
      });

      clearTimeout(timer);

      if (!response.ok) {
        return `Error: HTTP ${response.status} ${response.statusText}`;
      }

      const contentType = response.headers.get("content-type") || "";
      const text = await response.text();

      // Truncate very large responses
      if (text.length > 50000) {
        return text.slice(0, 50000) + "\n...(truncated, " + text.length + " chars total)";
      }

      return text;
    } catch (e: any) {
      if (e.name === "AbortError") {
        return `Error: request timed out after ${timeout}ms`;
      }
      return `Error: ${e.message}`;
    }
  },
});
