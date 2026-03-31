import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { join } from "path";
import { embed, embedMany } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { log } from "./log.js";
import type { ModelMessage } from "ai";

const EMBEDDING_MODEL = "openai/text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
const MAX_CHUNK_TOKENS = 1000; // rough token limit per chunk

interface Chunk {
  id: number;
  session_id: string;
  msg_start: number;
  msg_end: number;
  text: string;
  timestamp: string;
  token_count: number;
}

interface RecallResult {
  text: string;
  timestamp: string;
  session_id: string;
  msg_start: number;
  msg_end: number;
  distance: number;
}

export class RecallIndex {
  private db: Database.Database;
  private embeddingModel: Parameters<typeof embed>[0]["model"];
  private agentDir: string;

  constructor(agentDir: string, provider: string) {
    this.agentDir = agentDir;
    const dbPath = join(agentDir, ".kern", "recall.db");
    this.db = new Database(dbPath);
    sqliteVec.load(this.db);

    // Create embedding model — use OpenAI-compatible endpoint
    const apiKey = provider === "openrouter"
      ? process.env.OPENROUTER_API_KEY
      : provider === "openai"
        ? process.env.OPENAI_API_KEY
        : process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new Error("No API key available for embeddings (need OPENROUTER_API_KEY or OPENAI_API_KEY)");
    }

    const client = createOpenAI({
      baseURL: provider === "openai" ? undefined : "https://openrouter.ai/api/v1",
      apiKey,
    });
    const modelId = provider === "openai" ? "text-embedding-3-small" : EMBEDDING_MODEL;
    this.embeddingModel = client.embeddingModel(modelId);

    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        msg_start INTEGER NOT NULL,
        msg_end INTEGER NOT NULL,
        text TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        token_count INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS index_state (
        session_id TEXT PRIMARY KEY,
        last_indexed_msg INTEGER NOT NULL
      );
    `);

    // Create vec table separately (virtual tables don't support IF NOT EXISTS in all versions)
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE vec_chunks USING vec0(
          embedding FLOAT[${EMBEDDING_DIMENSIONS}]
        );
      `);
    } catch {
      // Already exists — fine
    }
  }

  /**
   * Index new messages from a session's JSONL file.
   */
  async indexSession(sessionId: string): Promise<number> {
    const jsonlPath = join(this.agentDir, ".kern", "sessions", `${sessionId}.jsonl`);
    if (!existsSync(jsonlPath)) return 0;

    const content = await readFile(jsonlPath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    if (lines.length <= 1) return 0; // only metadata line

    // Messages start at line index 1
    const messages: ModelMessage[] = lines.slice(1).map((l) => JSON.parse(l));

    // Get last indexed position
    const state = this.db.prepare("SELECT last_indexed_msg FROM index_state WHERE session_id = ?").get(sessionId) as { last_indexed_msg: number } | undefined;
    const lastIndexed = state?.last_indexed_msg ?? 0;

    if (lastIndexed >= messages.length) return 0;

    // Parse session metadata for timestamp interpolation
    const meta = JSON.parse(lines[0]);
    const sessionCreated = new Date(meta.createdAt).getTime();
    const sessionUpdated = new Date(meta.updatedAt).getTime();

    // Chunk new messages by turn
    const chunks = this.chunkMessages(messages, lastIndexed, sessionId, sessionCreated, sessionUpdated);
    if (chunks.length === 0) return 0;

    // Embed chunks in batches (API limits)
    const BATCH_SIZE = 100;
    const texts = chunks.map((c) => c.text);
    log("runtime", `recall: embedding ${texts.length} chunks (${texts.reduce((a, t) => a + t.length, 0)} chars)`);

    const embeddings: number[][] = [];
    try {
      for (let b = 0; b < texts.length; b += BATCH_SIZE) {
        const batch = texts.slice(b, b + BATCH_SIZE);
        const result = await embedMany({ model: this.embeddingModel, values: batch });
        embeddings.push(...result.embeddings);
        if (texts.length > BATCH_SIZE) {
          log("runtime", `recall: embedded batch ${Math.floor(b / BATCH_SIZE) + 1}/${Math.ceil(texts.length / BATCH_SIZE)}`);
        }
      }
    } catch (err: any) {
      log("runtime", `recall: embedding failed: ${err.message}`);
      return 0;
    }

    // Insert into DB
    const insertChunk = this.db.prepare(
      "INSERT INTO chunks (session_id, msg_start, msg_end, text, timestamp, token_count) VALUES (?, ?, ?, ?, ?, ?)"
    );
    const insertVec = this.db.prepare(
      "INSERT INTO vec_chunks (rowid, embedding) VALUES (?, ?)"
    );
    const upsertState = this.db.prepare(
      "INSERT OR REPLACE INTO index_state (session_id, last_indexed_msg) VALUES (?, ?)"
    );

    let indexed = 0;
    const tx = this.db.transaction(() => {
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const info = insertChunk.run(
          chunk.session_id,
          chunk.msg_start,
          chunk.msg_end,
          chunk.text,
          chunk.timestamp,
          chunk.token_count
        );
        const chunkId = typeof info.lastInsertRowid === "bigint" ? info.lastInsertRowid : BigInt(info.lastInsertRowid);
        insertVec.run(chunkId, new Float32Array(embeddings[i]));
        indexed++;
      }
      upsertState.run(sessionId, messages.length);
    });
    tx();

    log("runtime", `recall: indexed ${indexed} chunks for session ${sessionId.slice(0, 8)}...`);
    return indexed;
  }

  /**
   * Search for relevant chunks by query.
   */
  async search(query: string, limit: number = 5): Promise<RecallResult[]> {
    const { embedding } = await embed({ model: this.embeddingModel, value: query });

    const rows = this.db.prepare(`
      SELECT
        v.rowid,
        v.distance,
        c.text,
        c.timestamp,
        c.session_id,
        c.msg_start,
        c.msg_end
      FROM vec_chunks v
      JOIN chunks c ON c.id = v.rowid
      WHERE embedding MATCH ? AND k = ?
      ORDER BY distance
    `).all(new Float32Array(embedding), limit) as Array<{
      rowid: number;
      distance: number;
      text: string;
      timestamp: string;
      session_id: string;
      msg_start: number;
      msg_end: number;
    }>;

    return rows.map((r) => ({
      text: r.text,
      timestamp: r.timestamp,
      session_id: r.session_id,
      msg_start: r.msg_start,
      msg_end: r.msg_end,
      distance: r.distance,
    }));
  }

  /**
   * Load raw messages from a session by index range.
   */
  async loadMessages(sessionId: string, start: number, end: number): Promise<string> {
    const jsonlPath = join(this.agentDir, ".kern", "sessions", `${sessionId}.jsonl`);
    if (!existsSync(jsonlPath)) return "Session not found.";

    const content = await readFile(jsonlPath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    const messages: ModelMessage[] = lines.slice(1).map((l) => JSON.parse(l));

    const from = Math.max(0, start);
    const to = Math.min(messages.length, end);
    const slice = messages.slice(from, to);

    return slice.map((msg, i) => {
      const idx = from + i;
      const content = typeof msg.content === "string"
        ? msg.content
        : JSON.stringify(msg.content);
      const preview = content.length > 500 ? content.slice(0, 500) + "..." : content;
      return `[${idx}] ${msg.role}: ${preview}`;
    }).join("\n\n");
  }

  /**
   * Chunk messages into turns starting from a given offset.
   */
  private chunkMessages(
    messages: ModelMessage[],
    startFrom: number,
    sessionId: string,
    sessionCreated: number,
    sessionUpdated: number
  ): Array<{ session_id: string; msg_start: number; msg_end: number; text: string; timestamp: string; token_count: number }> {
    const chunks: Array<{ session_id: string; msg_start: number; msg_end: number; text: string; timestamp: string; token_count: number }> = [];

    let i = startFrom;
    while (i < messages.length) {
      const msg = messages[i];

      // Start a turn at a user message
      if (msg.role !== "user") {
        i++;
        continue;
      }

      const turnStart = i;
      const parts: string[] = [];
      let tokenCount = 0;

      // Collect user message
      const userText = this.messageToText(msg);
      parts.push(`User: ${userText}`);
      tokenCount += Math.ceil(userText.length / 4);
      i++;

      // Collect assistant + tool messages until next user message or end
      while (i < messages.length && messages[i].role !== "user") {
        const m = messages[i];
        const text = this.messageToText(m);
        const textTokens = Math.ceil(text.length / 4);

        // Don't let chunks get too big
        if (tokenCount + textTokens > MAX_CHUNK_TOKENS * 2 && parts.length > 1) {
          break;
        }

        if (m.role === "assistant") {
          parts.push(`Assistant: ${text}`);
        } else if (m.role === "tool") {
          // Truncate tool results
          const truncated = text.length > 200 ? text.slice(0, 200) + "..." : text;
          parts.push(`Tool: ${truncated}`);
        }
        tokenCount += textTokens;
        i++;
      }

      const turnEnd = i;
      const chunkText = parts.join("\n");

      // Extract timestamp from message metadata (e.g. "[via web, ..., time: 2026-03-30T...]")
      let timestamp = "";
      for (let j = turnStart; j < turnEnd && !timestamp; j++) {
        const content = typeof messages[j].content === "string" ? messages[j].content as string : "";
        const timeMatch = content.match(/time: (\d{4}-\d{2}-\d{2}T[\d:.]+Z)/);
        if (timeMatch) timestamp = timeMatch[1];
      }
      // Fallback: interpolate from position in session
      if (!timestamp) {
        const progress = messages.length > 1 ? turnStart / (messages.length - 1) : 0;
        const estimated = sessionCreated + progress * (sessionUpdated - sessionCreated);
        timestamp = new Date(estimated).toISOString();
      }

      chunks.push({
        session_id: sessionId,
        msg_start: turnStart,
        msg_end: turnEnd,
        text: chunkText,
        timestamp,
        token_count: Math.ceil(chunkText.length / 4),
      });
    }

    return chunks;
  }

  private messageToText(msg: ModelMessage): string {
    if (typeof msg.content === "string") return msg.content;
    if (Array.isArray(msg.content)) {
      return (msg.content as any[]).map((part) => {
        if (part.type === "text") return part.text;
        if (part.type === "tool-call") return `[tool: ${part.toolName}]`;
        if (part.type === "tool-result") {
          const out = typeof part.output === "string" ? part.output : JSON.stringify(part.output);
          return out.length > 200 ? out.slice(0, 200) + "..." : out;
        }
        return JSON.stringify(part);
      }).join(" ");
    }
    return JSON.stringify(msg.content);
  }

  getStats(): { chunks: number; sessions: number } {
    const chunks = (this.db.prepare("SELECT COUNT(*) as count FROM chunks").get() as any).count;
    const sessions = (this.db.prepare("SELECT COUNT(*) as count FROM index_state").get() as any).count;
    return { chunks, sessions };
  }

  close(): void {
    this.db.close();
  }
}
