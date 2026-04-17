import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

interface PairingCode {
  code: string;
  userId: string;
  interface: string;
  channel: string;
  createdAt: string;
}

interface PairedUser {
  userId: string;
  chatId: string;
  interface: string;
  pairedAt: string;
}

interface PairingData {
  pending: PairingCode[];
  paired: PairedUser[];
}

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1 to avoid confusion
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return `KERN-${code}`;
}

export class PairingManager {
  private file: string;
  private data: PairingData = { pending: [], paired: [] };

  constructor(agentDir: string) {
    this.file = join(agentDir, ".kern", "pairing.json");
  }

  async load(): Promise<void> {
    if (!existsSync(this.file)) {
      this.data = { pending: [], paired: [] };
      return;
    }
    try {
      this.data = JSON.parse(await readFile(this.file, "utf-8"));
    } catch {
      this.data = { pending: [], paired: [] };
    }
  }

  private async save(): Promise<void> {
    await writeFile(this.file, JSON.stringify(this.data, null, 2) + "\n");
  }

  // Check if a user is paired
  isPaired(userId: string): boolean {
    return this.data.paired.some((u) => u.userId === userId);
  }

  // Check if this is the first user ever — auto-pair them
  hasAnyPairedUsers(): boolean {
    return this.data.paired.length > 0;
  }

  async autoPairFirst(userId: string, iface: string, chatId: string): Promise<void> {
    this.data.paired.push({
      userId,
      chatId,
      interface: iface,
      pairedAt: new Date().toISOString(),
    });
    await this.save();
  }

  // Generate or return existing code for an unpaired user
  async getOrCreateCode(userId: string, iface: string, channel: string): Promise<string> {
    // Already have a pending code for this user?
    const existing = this.data.pending.find((p) => p.userId === userId);
    if (existing) return existing.code;

    const code = generateCode();
    this.data.pending.push({
      code,
      userId,
      interface: iface,
      channel,
      createdAt: new Date().toISOString(),
    });
    await this.save();
    return code;
  }

  // Validate a code and return the associated user info
  async pair(code: string): Promise<{ userId: string; chatId: string; interface: string } | null> {
    const idx = this.data.pending.findIndex(
      (p) => p.code.toUpperCase() === code.toUpperCase(),
    );
    if (idx < 0) return null;

    const pending = this.data.pending[idx];
    // Extract chatId from channel (e.g. "telegram:12345" → "12345", or
    // "matrix:!abc:example.com" → "!abc:example.com"). Split only on the
    // first colon so interface-internal IDs containing colons (like Matrix
    // room IDs) round-trip intact.
    const colonIdx = pending.channel.indexOf(":");
    const chatId = colonIdx >= 0 ? pending.channel.slice(colonIdx + 1) : pending.userId;
    this.data.pending.splice(idx, 1);
    this.data.paired.push({
      userId: pending.userId,
      chatId,
      interface: pending.interface,
      pairedAt: new Date().toISOString(),
    });
    await this.save();
    return { userId: pending.userId, chatId, interface: pending.interface };
  }

  // Look up a paired user's chatId
  getChatId(userId: string): string | null {
    const user = this.data.paired.find((u) => u.userId === userId);
    return user?.chatId || null;
  }

  // Get all paired users
  getPairedUsers(): PairedUser[] {
    return this.data.paired;
  }

  // Get pending codes (for debugging)
  getPendingCodes(): PairingCode[] {
    return this.data.pending;
  }
}
