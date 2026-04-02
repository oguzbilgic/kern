import { readFile, readdir, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { log } from "./log.js";
import type { KernConfig } from "./config.js";

interface NotesCache {
  key: string;
  summary: string;
}

const SUMMARY_PROMPT = `Summarize the following daily notes into a brief context summary. Include: key events, decisions made, what changed, and anything unresolved. Be concise — this will be injected as context for an AI agent.`;

function createModel(config: KernConfig) {
  switch (config.provider) {
    case "anthropic": {
      const anthropic = createAnthropic();
      return anthropic(config.model);
    }
    case "openrouter": {
      const openrouter = createOpenAI({
        baseURL: "https://openrouter.ai/api/v1",
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

// Read sorted .md files from notes/ directory
async function listNotes(notesDir: string): Promise<string[]> {
  if (!existsSync(notesDir)) return [];
  const files = await readdir(notesDir);
  return files.filter(f => f.endsWith(".md")).sort();
}

// Load cached summary from .kern/notes-context.json
async function loadCache(agentDir: string): Promise<NotesCache | null> {
  const cachePath = join(agentDir, ".kern", "notes-context.json");
  if (!existsSync(cachePath)) return null;
  try {
    return JSON.parse(await readFile(cachePath, "utf-8"));
  } catch {
    return null;
  }
}

// Save summary cache
async function saveCache(agentDir: string, cache: NotesCache): Promise<void> {
  const kernDir = join(agentDir, ".kern");
  if (!existsSync(kernDir)) await mkdir(kernDir, { recursive: true });
  await writeFile(join(kernDir, "notes-context.json"), JSON.stringify(cache, null, 2));
}

// Generate summary from notes content
async function generateSummary(notes: string, config: KernConfig): Promise<string> {
  const model = createModel(config);
  const result = await generateText({
    model,
    messages: [
      { role: "user", content: `${SUMMARY_PROMPT}\n\n${notes}` },
    ],
    maxOutputTokens: 1000,
  });
  return result.text;
}

/**
 * Load notes context for system prompt injection.
 * Returns: { latest, summary } — either or both may be null.
 *
 * Summary is cached in .kern/notes-context.json, keyed by latest note filename.
 * Regenerated synchronously on cache miss (new day = new latest filename).
 */
export async function loadNotesContext(
  agentDir: string,
  config: KernConfig,
): Promise<{ latest: string | null; summary: string | null }> {
  const notesDir = join(agentDir, "notes");
  const mdFiles = await listNotes(notesDir);

  if (mdFiles.length === 0) return { latest: null, summary: null };

  // Latest note — always inject raw
  const latestFile = mdFiles[mdFiles.length - 1];
  let latest: string | null = null;
  try {
    const content = await readFile(join(notesDir, latestFile), "utf-8");
    if (content.trim()) latest = content.trim();
  } catch {}

  // Summary of previous notes (up to 5 before latest)
  if (mdFiles.length < 2) return { latest, summary: null };

  const cache = await loadCache(agentDir);
  if (cache && cache.key === latestFile) {
    return { latest, summary: cache.summary };
  }

  // Cache miss — generate summary from up to 5 notes before latest
  const prevFiles = mdFiles.slice(-6, -1); // up to 5 notes before latest
  try {
    const contents = await Promise.all(
      prevFiles.map(f => readFile(join(notesDir, f), "utf-8")),
    );
    const combined = contents.join("\n\n---\n\n");
    log("notes", `generating summary from ${prevFiles.length} notes (${combined.length} chars)`);
    const summary = await generateSummary(combined, config);
    await saveCache(agentDir, { key: latestFile, summary });
    log("notes", `summary cached (${summary.length} chars)`);
    return { latest, summary };
  } catch (err: any) {
    log("notes", `summary generation failed: ${err.message}`);
    return { latest, summary: null };
  }
}
