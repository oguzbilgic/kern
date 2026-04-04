import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import type { ModelMessage } from "ai";
import type { MemoryDB } from "./memory.js";
import { log } from "./log.js";

export interface Session {
  id: string;
  messages: ModelMessage[];
  createdAt: string;
  updatedAt: string;
}

export class SessionManager {
  private dir: string;
  private session: Session | null = null;
  private db: MemoryDB["db"] | null = null;

  constructor(agentDir: string, memoryDB?: MemoryDB) {
    this.dir = join(agentDir, ".kern", "sessions");
    this.db = memoryDB?.db ?? null;
  }

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  async load(id?: string): Promise<Session> {
    // If no ID, load the most recent session or create new
    if (!id) {
      const latest = await this.findLatest();
      if (latest) {
        this.session = latest;
        return latest;
      }
      return this.create();
    }

    const path = join(this.dir, `${id}.jsonl`);
    if (!existsSync(path)) {
      return this.create(id);
    }

    const content = await readFile(path, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);

    // First line is metadata, rest are messages
    const meta = JSON.parse(lines[0]);
    const messages: ModelMessage[] = lines.slice(1).map((l) => JSON.parse(l));

    // Detect incomplete turn — if session ends with assistant tool-call
    // without a matching tool result, the previous process died mid-turn.
    // Append a synthetic message so the model doesn't re-execute.
    if (messages.length > 0) {
      const last = messages[messages.length - 1];
      if (last.role === "assistant" && Array.isArray(last.content)) {
        const hasToolCall = (last.content as any[]).some((p) => p.type === "tool-call");
        const nextIsTool = false; // it's the last message, no tool result follows
        if (hasToolCall) {
          messages.push({
            role: "user",
            content: "[system] Previous turn was interrupted. Tool results were lost. Continue normally.",
          } as ModelMessage);
        }
      }
    }

    this.session = {
      id: meta.id,
      messages,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
    };

    return this.session;
  }

  async create(id?: string): Promise<Session> {
    const now = new Date().toISOString();
    this.session = {
      id: id || crypto.randomUUID(),
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    await this.save();
    return this.session;
  }

  async append(messages: ModelMessage[]): Promise<void> {
    if (!this.session) throw new Error("No active session");
    const startIndex = this.session.messages.length;
    this.session.messages.push(...messages);
    this.session.updatedAt = new Date().toISOString();

    // Write to DB first (atomic, crash-safe)
    if (this.db) {
      try {
        const insert = this.db.prepare(
          "INSERT OR IGNORE INTO messages (session_id, msg_index, role, content, timestamp) VALUES (?, ?, ?, ?, ?)"
        );
        const tx = this.db.transaction(() => {
          for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];
            const msgIndex = startIndex + i;
            const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
            // Extract timestamp from message metadata
            let timestamp: string | null = null;
            const timeMatch = content.match(/time: (\d{4}-\d{2}-\d{2}T[\d:.]+Z)/);
            if (timeMatch) timestamp = timeMatch[1];
            insert.run(this.session!.id, msgIndex, msg.role, content, timestamp);
          }
        });
        tx();
      } catch (err: any) {
        log.error("session", `DB write failed: ${err.message}`);
      }
    }

    // Write JSONL (still primary for reads)
    await this.save();
  }

  getMessages(): ModelMessage[] {
    return this.session?.messages || [];
  }

  getSessionId(): string | null {
    return this.session?.id || null;
  }

  private async save(): Promise<void> {
    if (!this.session) return;
    const path = join(this.dir, `${this.session.id}.jsonl`);
    const meta = JSON.stringify({
      id: this.session.id,
      createdAt: this.session.createdAt,
      updatedAt: this.session.updatedAt,
    });
    const lines = [
      meta,
      ...this.session.messages.map((m) => JSON.stringify(m)),
    ];
    await writeFile(path, lines.join("\n") + "\n", "utf-8");
  }

  private async findLatest(): Promise<Session | null> {
    const { readdir, stat } = await import("fs/promises");
    try {
      const files = await readdir(this.dir);
      const jsonl = files.filter((f) => f.endsWith(".jsonl"));
      if (jsonl.length === 0) return null;

      // Find most recently modified
      let latest = { file: "", mtime: 0 };
      for (const f of jsonl) {
        const s = await stat(join(this.dir, f));
        if (s.mtimeMs > latest.mtime) {
          latest = { file: f, mtime: s.mtimeMs };
        }
      }

      const id = latest.file.replace(".jsonl", "");
      return this.load(id);
    } catch {
      return null;
    }
  }
}
