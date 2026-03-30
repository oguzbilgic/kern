import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";

interface Contact {
  id: string;
  name: string;
  pairedAt: string;
}

interface PendingCode {
  code: string;
  fromId: string;
  createdAt: string;
}

interface HubContactsData {
  contacts: Contact[];
  pending: PendingCode[];
}

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return `KERN-${code}`;
}

export class HubContacts {
  private file: string;
  private data: HubContactsData = { contacts: [], pending: [] };

  constructor(agentDir: string) {
    this.file = join(agentDir, ".kern", "hub-contacts.json");
  }

  async load(): Promise<void> {
    if (!existsSync(this.file)) {
      this.data = { contacts: [], pending: [] };
      return;
    }
    try {
      this.data = JSON.parse(await readFile(this.file, "utf-8"));
    } catch {
      this.data = { contacts: [], pending: [] };
    }
  }

  private async save(): Promise<void> {
    await writeFile(this.file, JSON.stringify(this.data, null, 2) + "\n");
  }

  isPaired(id: string): boolean {
    return this.data.contacts.some(c => c.id === id);
  }

  getContact(id: string): Contact | null {
    return this.data.contacts.find(c => c.id === id) || null;
  }

  getContacts(): Contact[] {
    return this.data.contacts;
  }

  // Unknown agent messaged us — generate a pairing code
  async createCodeForSender(fromId: string): Promise<string> {
    const existing = this.data.pending.find(p => p.fromId === fromId);
    if (existing) return existing.code;

    const code = generateCode();
    this.data.pending.push({
      code,
      fromId,
      createdAt: new Date().toISOString(),
    });
    await this.save();
    return code;
  }

  // Operator approves a pairing code and provides a name
  async pair(code: string, name: string): Promise<{ id: string } | null> {
    const idx = this.data.pending.findIndex(
      p => p.code.toUpperCase() === code.toUpperCase()
    );
    if (idx < 0) return null;

    const pending = this.data.pending[idx];
    this.data.pending.splice(idx, 1);
    this.data.contacts.push({
      id: pending.fromId,
      name,
      pairedAt: new Date().toISOString(),
    });
    await this.save();
    return { id: pending.fromId };
  }

  // Add a contact directly (e.g. from confirmation)
  async addContact(id: string, name: string): Promise<void> {
    if (this.isPaired(id)) return;
    this.data.contacts.push({
      id,
      name,
      pairedAt: new Date().toISOString(),
    });
    await this.save();
  }

  getPendingCodes(): PendingCode[] {
    return this.data.pending;
  }
}
