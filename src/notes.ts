import { readFile, readdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { generateText } from "ai";
import { log } from "./log.js";
import { createModel } from "./model.js";
import type { KernConfig } from "./config.js";
import type { MemoryDB } from "./memory.js";

const SUMMARY_TYPE = "daily_notes";
const SUMMARY_PROMPT = `Summarize the following daily notes into a brief context summary. Include: key events, decisions made, what changed, and anything unresolved. Be concise — this will be injected as context for an AI agent.`;

let generating = false;

// Read sorted .md files from notes/ directory
async function listNotes(notesDir: string): Promise<string[]> {
  if (!existsSync(notesDir)) return [];
  const files = await readdir(notesDir);
  return files.filter(f => f.endsWith(".md")).sort();
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

// Background regeneration — fire and forget
function regenerateInBackground(
  memoryDB: MemoryDB,
  config: KernConfig,
  notesDir: string,
  prevFiles: string[],
  latestFile: string,
): void {
  if (generating) return;
  generating = true;

  (async () => {
    try {
      const contents = await Promise.all(
        prevFiles.map(f => readFile(join(notesDir, f), "utf-8")),
      );
      const combined = contents.join("\n\n---\n\n");
      log("notes", `generating summary from ${prevFiles.length} notes (${combined.length} chars)`);
      const summary = await generateSummary(combined, config);
      const dateStart = prevFiles[0].replace(".md", "");
      const dateEnd = prevFiles[prevFiles.length - 1].replace(".md", "");
      memoryDB.saveSummary(SUMMARY_TYPE, dateStart, dateEnd, latestFile, summary);
      log("notes", `summary cached (${summary.length} chars)`);
    } catch (err: any) {
      log("notes", `summary generation failed: ${err.message}`);
    } finally {
      generating = false;
    }
  })();
}

/**
 * Load notes context for system prompt injection.
 * Returns: { latest, summary } — either or both may be null.
 *
 * Summary is cached in recall.db summaries table, keyed by latest note filename.
 * On cache miss, serves stale summary (if any) and regenerates in background.
 */
export async function loadNotesContext(
  agentDir: string,
  config: KernConfig,
  memoryDB: MemoryDB | null,
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
  if (mdFiles.length < 2 || !memoryDB) return { latest, summary: null };

  // Check cache — exact match on source_key
  const cached = memoryDB.getSummary(SUMMARY_TYPE, latestFile);
  if (cached) {
    return { latest, summary: cached };
  }

  // Cache miss — serve stale (most recent summary), regenerate in background
  const stale = memoryDB.getLatestSummary(SUMMARY_TYPE);
  const prevFiles = mdFiles.slice(-6, -1); // up to 5 notes before latest
  regenerateInBackground(memoryDB, config, notesDir, prevFiles, latestFile);

  return { latest, summary: stale?.text ?? null };
}
