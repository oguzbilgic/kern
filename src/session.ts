import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import type { ModelMessage } from "ai";

export interface Session {
  id: string;
  messages: ModelMessage[];
  createdAt: string;
  updatedAt: string;
}

export class SessionManager {
  private dir: string;
  private session: Session | null = null;

  constructor(agentDir: string) {
    this.dir = join(agentDir, ".kern", "sessions");
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
    this.session.messages.push(...messages);
    this.session.updatedAt = new Date().toISOString();
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
