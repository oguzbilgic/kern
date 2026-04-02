import { embed, embedMany, generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { log } from "./log.js";
import type { MemoryDB } from "./memory.js";
import type Database from "better-sqlite3";

const EMBEDDING_MODEL = "openai/text-embedding-3-small";
const SUMMARY_MODEL = "openai/gpt-4.1-nano";

// Segmentation parameters
const TOPIC_THRESHOLD = 0.75;   // cosine distance — hard cut at topic shift
const TARGET_TOKENS = 3000;     // soft target per segment
const MIN_TOKENS = 500;         // floor — don't create tiny fragments
const MERGE_THRESHOLD = 0.6;    // merge tiny segments if closer than this
const WINDOW_SIZE = 5;          // embed windows of N messages for smoother distances

// Batch size for embedding API calls
const EMBED_BATCH_SIZE = 100;

// Max messages to process per indexSession call (prevents OOM on large backfills)
const MAX_CHUNK_SIZE = 500;

interface MessageRow {
  id: number;
  msg_index: number;
  role: string;
  content: string;
  timestamp: string | null;
}

interface Segment {
  session_id: string;
  msg_start: number;
  msg_end: number;
  text: string;
  token_count: number;
  embedding: number[];
}

export class SegmentIndex {
  private db: Database.Database;
  private embeddingModel: ReturnType<ReturnType<typeof createOpenAI>["embeddingModel"]>;
  private summaryModel: ReturnType<ReturnType<typeof createOpenAI>["chat"]>;

  constructor(memoryDB: MemoryDB, provider: string) {
    this.db = memoryDB.db;

    const apiKey = provider === "openrouter"
      ? process.env.OPENROUTER_API_KEY
      : provider === "openai"
        ? process.env.OPENAI_API_KEY
        : process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY;

    if (!apiKey) {
      throw new Error("No API key for embeddings");
    }

    const client = createOpenAI({
      baseURL: provider === "openai" ? undefined : "https://openrouter.ai/api/v1",
      apiKey,
      headers: provider !== "openai" ? {
        "HTTP-Referer": "https://github.com/oguzbilgic/kern-ai",
        "X-Title": "kern-ai",
      } : undefined,
    });
    const modelId = provider === "openai" ? "text-embedding-3-small" : EMBEDDING_MODEL;
    this.embeddingModel = client.embeddingModel(modelId);
    const summaryModelId = provider === "openai" ? "gpt-4.1-nano" : SUMMARY_MODEL;
    this.summaryModel = client.chat(summaryModelId);
  }

  /**
   * Build semantic segments for new messages in a session.
   * Reads from the messages table, computes embeddings, detects topic boundaries.
   * Returns the number of new segments created.
   */
  async indexSession(sessionId: string): Promise<number> {
    // Get last segmented position
    const state = this.db.prepare(
      "SELECT last_segmented_msg FROM segment_state WHERE session_id = ?"
    ).get(sessionId) as { last_segmented_msg: number } | undefined;
    const lastSegmented = state?.last_segmented_msg ?? 0;

    // Load new messages from the messages table — chunked to prevent OOM
    const allMessages = this.db.prepare(
      "SELECT id, msg_index, role, content, timestamp FROM messages WHERE session_id = ? AND msg_index >= ? ORDER BY msg_index"
    ).all(sessionId, lastSegmented) as MessageRow[];

    if (allMessages.length < 3) return 0;

    let totalCreated = 0;

    // Process in chunks
    for (let chunkStart = 0; chunkStart < allMessages.length; chunkStart += MAX_CHUNK_SIZE) {
      const messages = allMessages.slice(chunkStart, chunkStart + MAX_CHUNK_SIZE);
      if (messages.length < 3) break;

      log("segments", `processing chunk ${Math.floor(chunkStart / MAX_CHUNK_SIZE) + 1}/${Math.ceil(allMessages.length / MAX_CHUNK_SIZE)} (${messages.length} messages)`);

      // Build windowed text for embedding — smooths out per-message noise
      const windowTexts = this.buildWindowTexts(messages);

      // Embed windows
      const embeddings = await this.embedTexts(windowTexts);
      if (embeddings.length !== messages.length) {
        log("segments", `embedding count mismatch: ${embeddings.length} vs ${messages.length}`);
        continue;
      }

      // Compute pairwise cosine distances between consecutive windows
      const distances: number[] = [0];
      for (let i = 1; i < embeddings.length; i++) {
        distances.push(cosineDistance(embeddings[i - 1], embeddings[i]));
      }

      // Segment: walk through messages, split at topic boundaries or token targets
      const rawSegments = this.buildSegments(messages, embeddings, distances, sessionId);

      // Merge tiny segments into neighbors
      const merged = this.mergeSmallSegments(rawSegments);

      if (merged.length === 0) continue;

      // Store segments
      const insertSeg = this.db.prepare(
        "INSERT OR IGNORE INTO semantic_segments (session_id, msg_start, msg_end, level, summary, token_count) VALUES (?, ?, ?, 0, ?, ?)"
      );
      const insertVec = this.db.prepare(
        "INSERT INTO vec_segments (rowid, embedding) VALUES (?, ?)"
      );
      const upsertState = this.db.prepare(
        "INSERT OR REPLACE INTO segment_state (session_id, last_segmented_msg) VALUES (?, ?)"
      );

      let created = 0;
      const lastMsgIndex = messages[messages.length - 1].msg_index;

      const tx = this.db.transaction(() => {
        for (const seg of merged) {
          const info = insertSeg.run(seg.session_id, seg.msg_start, seg.msg_end, seg.text, seg.token_count);
          if (info.changes === 0) continue;
          const segId = typeof info.lastInsertRowid === "bigint" ? info.lastInsertRowid : BigInt(info.lastInsertRowid);
          insertVec.run(segId, new Float32Array(seg.embedding));
          created++;
        }
        upsertState.run(sessionId, lastMsgIndex);
      });
      tx();

      totalCreated += created;

      if (created > 0) {
        log("segments", `created ${created} segments from chunk`);
      }
    }

    if (totalCreated > 0) {
      log("segments", `total ${totalCreated} segments for session ${sessionId.slice(0, 8)}...`);
      // Summarize in background
      this.summarizeUnsummarized().catch((err) => {
        log("segments", `summarization failed: ${err.message}`);
      });
    }

    return totalCreated;
  }

  /**
   * Build windowed text for embedding — each entry is the concatenation of
   * WINDOW_SIZE messages centered on that position. Smooths out per-message noise.
   */
  private buildWindowTexts(messages: MessageRow[]): string[] {
    const half = Math.floor(WINDOW_SIZE / 2);
    return messages.map((_, i) => {
      const start = Math.max(0, i - half);
      const end = Math.min(messages.length, i + half + 1);
      return messages.slice(start, end).map(m => `${m.role}: ${this.messageText(m)}`).join("\n");
    });
  }

  /**
   * Summarize all unsummarized segments.
   * Idempotent — safe to call repeatedly. Picks up segments from any session
   * that have summarized=0, including ones from crashed/interrupted runs.
   */
  async summarizeUnsummarized(): Promise<number> {
    const rows = this.db.prepare(
      "SELECT id, summary FROM semantic_segments WHERE summarized = 0 ORDER BY id"
    ).all() as Array<{ id: number; summary: string }>;

    if (rows.length === 0) return 0;

    log("segments", `summarizing ${rows.length} segments...`);

    const update = this.db.prepare(
      "UPDATE semantic_segments SET summary = ?, token_count = ?, summarized = 1 WHERE id = ?"
    );

    let summarized = 0;
    for (const row of rows) {
      try {
        const result = await generateText({
          model: this.summaryModel,
          prompt: `Summarize this conversation segment concisely in 2-3 sentences. Focus on what was discussed, decided, or done.\n\n${row.summary.slice(0, 8000)}`,
          maxOutputTokens: 200,
        });

        const summaryText = result.text.trim();
        if (summaryText) {
          update.run(summaryText, Math.ceil(summaryText.length / 4), row.id);
          summarized++;
        }
      } catch (err: any) {
        log("segments", `failed to summarize segment ${row.id}: ${err.message}`);
        // Leave it unsummarized — next run will retry
      }
    }

    if (summarized > 0) {
      log("segments", `summarized ${summarized} segments`);
    }
    return summarized;
  }

  /**
   * Split messages into segments based on semantic distance and token count.
   */
  private buildSegments(
    messages: MessageRow[],
    embeddings: number[][],
    distances: number[],
    sessionId: string,
  ): Segment[] {
    const segments: Segment[] = [];
    let segStart = 0;
    let segTokens = 0;

    const closeSegment = (end: number) => {
      if (end <= segStart) return;

      // Build segment text from messages
      const segMsgs = messages.slice(segStart, end);
      const text = segMsgs.map((m) => `${m.role}: ${this.messageText(m)}`).join("\n");
      const tokenCount = Math.ceil(text.length / 4);

      // Average the embeddings for this segment
      const segEmbeddings = embeddings.slice(segStart, end);
      const avgEmbedding = averageEmbeddings(segEmbeddings);

      segments.push({
        session_id: sessionId,
        msg_start: messages[segStart].msg_index,
        msg_end: messages[end - 1].msg_index + 1, // exclusive end
        text,
        token_count: tokenCount,
        embedding: avgEmbedding,
      });

      segStart = end;
      segTokens = 0;
    };

    for (let i = 0; i < messages.length; i++) {
      const msgTokens = Math.ceil(messages[i].content.length / 4);

      // Hard cut: topic shift
      if (i > segStart && distances[i] > TOPIC_THRESHOLD) {
        closeSegment(i);
      }

      // Soft cut: segment too large — find best split point
      if (segTokens + msgTokens > TARGET_TOKENS && i > segStart + 1) {
        // Find highest distance within current segment
        let bestSplit = segStart + 1;
        let bestDist = -1;
        for (let j = segStart + 1; j <= i; j++) {
          if (distances[j] > bestDist) {
            bestDist = distances[j];
            bestSplit = j;
          }
        }
        closeSegment(bestSplit);
      }

      segTokens += msgTokens;
    }

    // Close final segment
    closeSegment(messages.length);

    return segments;
  }

  /**
   * Merge segments below MIN_TOKENS into their closest neighbor.
   */
  private mergeSmallSegments(segments: Segment[]): Segment[] {
    if (segments.length <= 1) return segments;

    const result: Segment[] = [];
    let i = 0;

    while (i < segments.length) {
      const seg = segments[i];

      if (seg.token_count >= MIN_TOKENS || segments.length <= 1) {
        result.push(seg);
        i++;
        continue;
      }

      // Tiny segment — check neighbors
      const prev = result.length > 0 ? result[result.length - 1] : null;
      const next = i + 1 < segments.length ? segments[i + 1] : null;

      const distPrev = prev ? cosineDistance(prev.embedding, seg.embedding) : Infinity;
      const distNext = next ? cosineDistance(seg.embedding, next.embedding) : Infinity;
      const minDist = Math.min(distPrev, distNext);

      if (minDist > MERGE_THRESHOLD) {
        // Genuinely distinct, keep it
        result.push(seg);
        i++;
        continue;
      }

      if (distPrev <= distNext && prev) {
        // Merge into previous
        prev.msg_end = seg.msg_end;
        prev.text += "\n" + seg.text;
        prev.token_count += seg.token_count;
        prev.embedding = averageEmbeddings([prev.embedding, seg.embedding].map(e => e));
        i++;
      } else if (next) {
        // Merge into next
        next.msg_start = seg.msg_start;
        next.text = seg.text + "\n" + next.text;
        next.token_count += seg.token_count;
        next.embedding = averageEmbeddings([seg.embedding, next.embedding].map(e => e));
        i++;
      } else {
        result.push(seg);
        i++;
      }
    }

    return result;
  }

  /**
   * Convert a message row to embeddable text.
   * Truncates tool outputs to keep embeddings focused.
   */
  private messageText(msg: MessageRow): string {
    const content = msg.content;
    // Tool results: truncate for embedding
    if (msg.role === "tool") {
      return content.length > 300 ? content.slice(0, 300) + "..." : content;
    }
    // Assistant tool calls: extract tool names
    if (msg.role === "assistant" && content.startsWith("[{")) {
      try {
        const parts = JSON.parse(content);
        return parts.map((p: any) => {
          if (p.type === "tool-call") return `[tool: ${p.toolName}]`;
          if (p.type === "text") return p.text;
          return "";
        }).filter(Boolean).join(" ");
      } catch {
        return content.length > 500 ? content.slice(0, 500) + "..." : content;
      }
    }
    return content.length > 500 ? content.slice(0, 500) + "..." : content;
  }

  /**
   * Embed texts in batches.
   */
  private async embedTexts(texts: string[]): Promise<number[][]> {
    const embeddings: number[][] = [];
    for (let b = 0; b < texts.length; b += EMBED_BATCH_SIZE) {
      const batch = texts.slice(b, b + EMBED_BATCH_SIZE);
      const result = await embedMany({ model: this.embeddingModel, values: batch });
      embeddings.push(...result.embeddings);
      if (texts.length > EMBED_BATCH_SIZE) {
        log("segments", `embedded batch ${Math.floor(b / EMBED_BATCH_SIZE) + 1}/${Math.ceil(texts.length / EMBED_BATCH_SIZE)}`);
      }
    }
    return embeddings;
  }

  getStats(): { segments: number; level0: number } {
    const total = (this.db.prepare("SELECT COUNT(*) as n FROM semantic_segments").get() as any).n;
    const l0 = (this.db.prepare("SELECT COUNT(*) as n FROM semantic_segments WHERE level = 0").get() as any).n;
    return { segments: total, level0: l0 };
  }

  /**
   * Get all segments for visualization.
   */
  getSegments(sessionId?: string): { segments: any[]; stats: any } {
    const where = sessionId ? "WHERE session_id = ?" : "";
    const params = sessionId ? [sessionId] : [];

    const segments = this.db.prepare(
      `SELECT id, session_id, msg_start, msg_end, parent_id, level, summary, token_count, summarized, created_at
       FROM semantic_segments ${where} ORDER BY level, msg_start`
    ).all(...params) as any[];

    const stats = this.getStats();

    return { segments, stats };
  }
}

// --- Vector math ---

function cosineDistance(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 1;
  return 1 - dot / denom;
}

function averageEmbeddings(embeddings: number[][]): number[] {
  if (embeddings.length === 0) return [];
  if (embeddings.length === 1) return embeddings[0];
  const dim = embeddings[0].length;
  const avg = new Array(dim).fill(0);
  for (const emb of embeddings) {
    for (let i = 0; i < dim; i++) avg[i] += emb[i];
  }
  for (let i = 0; i < dim; i++) avg[i] /= embeddings.length;
  return avg;
}
