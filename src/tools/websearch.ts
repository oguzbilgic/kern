import { tool } from "ai";
import { z } from "zod";
import { htmlToMarkdown } from "../util.js";
import { log } from "../log.js";

const TIMEOUT = 5000;

type SearchProvider = {
  name: string;
  enabled: () => boolean;
  search: (query: string) => Promise<string>;
};

const searxng: SearchProvider = {
  name: "searxng",
  enabled: () => !!process.env.SEARXNG_URL,
  search: async (query) => {
    const base = process.env.SEARXNG_URL!.replace(/\/$/, "");
    const url = `${base}/search?q=${encodeURIComponent(query)}&format=json`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT);

    try {
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return JSON.stringify(data.results ?? data, null, 2);
    } catch (e) {
      clearTimeout(timer);
      throw e;
    }
  },
};

const ddg: SearchProvider = {
  name: "ddg",
  enabled: () => true,
  search: async (query) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT);

    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const res = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "User-Agent": "kern-ai/0.1",
          Accept: "text/html",
        },
      });

      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      let html = await res.text();
      const resultsStart = html.indexOf('<div class="serp__results">');
      if (resultsStart !== -1) html = html.slice(resultsStart);

      const result = htmlToMarkdown(html);
      if (result.length > 50000) {
        return result.slice(0, 50000) + "\n...(truncated, " + result.length + " chars total)";
      }
      return result;
    } catch (e) {
      clearTimeout(timer);
      throw e;
    }
  },
};

const providers: SearchProvider[] = [searxng, ddg];

export const websearchTool = tool({
  description:
    "Search the web using DuckDuckGo. Returns search results as markdown with titles, URLs, and snippets.",
  inputSchema: z.object({
    query: z.string().describe("The search query"),
  }),
  execute: async ({ query }) => {
    const active = providers.filter((p) => p.enabled());

    for (const provider of active) {
      try {
        const result = await provider.search(query);
        log.debug("tools", `websearch: ${provider.name} succeeded for "${query}"`);
        return result;
      } catch (e: any) {
        const reason = e.name === "AbortError" ? "timeout" : e.message;
        log.warn("tools", `websearch: ${provider.name} failed for "${query}": ${reason}`);
      }
    }

    return "Error: all search providers failed. Try again later or use webfetch with a direct URL.";
  },
});
