import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { join } from "path";
import { log } from "./log.js";

const EMBEDDING_DIMENSIONS = 1536;

/**
 * Central database for agent memory.
 * Owns .kern/recall.db — all tables, schema migrations.
 * Consumers (recall, notes) use the exposed db handle.
 */
export class MemoryDB {
  public db: Database.Database;

  constructor(agentDir: string) {
    const dbPath = join(agentDir, ".kern", "recall.db");
    this.db = new Database(dbPath);
    sqliteVec.load(this.db);
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        msg_index INTEGER NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp TEXT,
        UNIQUE(session_id, msg_index)
      );

      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        msg_start INTEGER NOT NULL,
        msg_end INTEGER NOT NULL,
        text TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        token_count INTEGER NOT NULL,
        UNIQUE(session_id, msg_start, msg_end)
      );

      CREATE TABLE IF NOT EXISTS index_state (
        session_id TEXT PRIMARY KEY,
        last_indexed_msg INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        date_start TEXT NOT NULL,
        date_end TEXT NOT NULL,
        source_key TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(type, source_key)
      );

      CREATE TABLE IF NOT EXISTS semantic_segments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        msg_start INTEGER NOT NULL,
        msg_end INTEGER NOT NULL,
        start_time TEXT,
        end_time TEXT,
        parent_id INTEGER REFERENCES semantic_segments(id),
        level INTEGER NOT NULL DEFAULT 0,
        summary TEXT NOT NULL,
        token_count INTEGER NOT NULL,
        summarized INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS segment_state (
        session_id TEXT PRIMARY KEY,
        last_segmented_msg INTEGER NOT NULL
      );
    `);

    // Indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_segments_session_level ON semantic_segments(session_id, level, msg_start);
      CREATE INDEX IF NOT EXISTS idx_segments_parent ON semantic_segments(parent_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_segments_unique ON semantic_segments(session_id, level, msg_start, msg_end);
    `);

    // Migrations — add columns to existing tables
    try { this.db.exec("ALTER TABLE semantic_segments ADD COLUMN start_time TEXT"); } catch {}
    try { this.db.exec("ALTER TABLE semantic_segments ADD COLUMN end_time TEXT"); } catch {}
    try { this.db.exec("ALTER TABLE semantic_segments ADD COLUMN summary_token_count INTEGER NOT NULL DEFAULT 0"); } catch {}

    // Create vec tables separately (virtual tables don't support IF NOT EXISTS in all versions)
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE vec_chunks USING vec0(
          embedding FLOAT[${EMBEDDING_DIMENSIONS}]
        );
      `);
    } catch {
      // Already exists — fine
    }

    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE vec_segments USING vec0(
          embedding FLOAT[${EMBEDDING_DIMENSIONS}]
        );
      `);
    } catch {
      // Already exists — fine
    }
  }

  // --- Summary helpers ---

  getSummary(type: string, sourceKey: string): string | null {
    const row = this.db.prepare(
      "SELECT text FROM summaries WHERE type = ? AND source_key = ?"
    ).get(type, sourceKey) as { text: string } | undefined;
    return row?.text ?? null;
  }

  getLatestSummary(type: string): { source_key: string; text: string } | null {
    const row = this.db.prepare(
      "SELECT source_key, text FROM summaries WHERE type = ? ORDER BY id DESC LIMIT 1"
    ).get(type) as { source_key: string; text: string } | undefined;
    return row ?? null;
  }

  saveSummary(type: string, dateStart: string, dateEnd: string, sourceKey: string, text: string): void {
    this.db.prepare(
      "INSERT OR REPLACE INTO summaries (type, date_start, date_end, source_key, text) VALUES (?, ?, ?, ?, ?)"
    ).run(type, dateStart, dateEnd, sourceKey, text);
  }

  getAllSummaries(type?: string): Array<{ id: number; type: string; date_start: string; date_end: string; source_key: string; text: string; created_at: string }> {
    if (type) {
      return this.db.prepare(
        "SELECT id, type, date_start, date_end, source_key, text, created_at FROM summaries WHERE type = ? ORDER BY id DESC"
      ).all(type) as any[];
    }
    return this.db.prepare(
      "SELECT id, type, date_start, date_end, source_key, text, created_at FROM summaries ORDER BY id DESC"
    ).all() as any[];
  }

  close(): void {
    this.db.close();
  }
}
