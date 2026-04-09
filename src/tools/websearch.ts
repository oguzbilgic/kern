import { tool } from "ai";
import { z } from "zod";
import { htmlToMarkdown } from "../util.js";

export const websearchTool = tool({
  description:
    "Search the web using DuckDuckGo. Returns search results as markdown with titles, URLs, and snippets.",
  inputSchema: z.object({
    query: z.string().describe("The search query"),
  }),
  execute: async ({ query }) => {
    const timeout = 30000;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const response = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "User-Agent": "kern-ai/0.1",
          Accept: "text/html",
        },
      });

      clearTimeout(timer);

      if (!response.ok) {
        return `Error: HTTP ${response.status} ${response.statusText}`;
      }

      let html = await response.text();

      // Strip DDG chrome — keep only the results section
      const resultsStart = html.indexOf('<div class="serp__results">');
      if (resultsStart !== -1) {
        html = html.slice(resultsStart);
      }

      const result = htmlToMarkdown(html);

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
