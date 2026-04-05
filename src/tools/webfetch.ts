import { tool } from "ai";
import { z } from "zod";
import { htmlToMarkdown } from "./markdown.js";

export const webfetchTool = tool({
  description:
    "Fetch content from a URL. HTML pages are converted to markdown by default. JSON and plain text are returned as-is. Useful for reading web pages, APIs, documentation.",
  inputSchema: z.object({
    url: z.string().describe("The URL to fetch"),
    raw: z
      .boolean()
      .optional()
      .describe("Return raw HTML instead of converting to markdown (default: false)"),
  }),
  execute: async ({ url, raw = false }) => {
    const timeout = 30000;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "kern-ai/0.1",
          Accept: "text/html,application/json,text/plain,*/*",
        },
      });

      clearTimeout(timer);

      if (!response.ok) {
        return `Error: HTTP ${response.status} ${response.statusText}`;
      }

      const contentType = response.headers.get("content-type") || "";
      const text = await response.text();

      // Convert HTML to markdown unless raw requested
      let result: string;
      if (!raw && contentType.includes("text/html")) {
        result = htmlToMarkdown(text);
      } else {
        result = text;
      }

      // Truncate very large responses
      if (result.length > 50000) {
        return (
          result.slice(0, 50000) +
          "\n...(truncated, " +
          result.length +
          " chars total)"
        );
      }

      return result;
    } catch (e: any) {
      if (e.name === "AbortError") {
        return `Error: request timed out after ${timeout}ms`;
      }
      return `Error: ${e.message}`;
    }
  },
});
