import type { Interface, StartOptions } from "./types.js";
import type { PairingManager } from "../pairing.js";
import { log } from "../log.js";

/**
 * Matrix interface — long-polls /sync, accepts invites, replies via /send.
 *
 * MVP scope:
 * - Text messages in/out
 * - Typing indicators while the agent is thinking
 * - Auto-accept invites (pairing comes later)
 * - No E2E encryption, no media, no reactions
 *
 * Config via env:
 *   MATRIX_HOMESERVER     e.g. http://matrix:8008
 *   MATRIX_USER_ID        e.g. @vega:matrix
 *   MATRIX_ACCESS_TOKEN   from login/register
 */
export class MatrixInterface implements Interface {
  private homeserver: string;
  private userId: string;
  private token: string;
  private pairing: PairingManager | null;
  private nextBatch: string | null = null;
  private running = false;
  private abort: AbortController | null = null;
  private _status: "connected" | "disconnected" | "error" = "disconnected";
  private _statusDetail?: string;
  // Gate pairing-code messages so we only send once per (user, room) per process.
  // Prevents agent-to-agent loops in shared rooms.
  private sentCodes = new Set<string>();

  constructor(
    homeserver: string,
    userId: string,
    token: string,
    pairing?: PairingManager,
  ) {
    // Strip trailing slash for clean URL joins
    this.homeserver = homeserver.replace(/\/$/, "");
    this.userId = userId;
    this.token = token;
    this.pairing = pairing || null;
  }

  get status() { return this._status; }
  get statusDetail() { return this._statusDetail; }

  async start({ onMessage }: StartOptions): Promise<void> {
    // Prime the sync cursor so we don't replay history on first connect
    try {
      const initial = await this.api<{ next_batch: string }>(
        "GET",
        "/_matrix/client/v3/sync?timeout=0",
      );
      this.nextBatch = initial.next_batch;
      this._status = "connected";
      log("matrix", `connected as ${this.userId}`);
    } catch (err: any) {
      this._status = "error";
      this._statusDetail = err.message || String(err);
      log.error("matrix", `initial sync failed: ${this._statusDetail}`);
      throw err;
    }

    this.running = true;
    this.syncLoop(onMessage).catch((err) => {
      log.error("matrix", `sync loop crashed: ${err.message || err}`);
      this._status = "error";
      this._statusDetail = err.message || String(err);
    });
  }

  async stop(): Promise<void> {
    this.running = false;
    this.abort?.abort();
    this._status = "disconnected";
  }

  async sendToUser(roomId: string, text: string): Promise<boolean> {
    try {
      await this.sendMessage(roomId, text);
      return true;
    } catch (err: any) {
      log.warn("matrix", `sendToUser failed: ${err.message || err}`);
      return false;
    }
  }

  private async syncLoop(
    onMessage: StartOptions["onMessage"],
  ): Promise<void> {
    while (this.running) {
      this.abort = new AbortController();
      try {
        const sync = await this.api<MatrixSync>(
          "GET",
          `/_matrix/client/v3/sync?since=${encodeURIComponent(this.nextBatch!)}&timeout=30000`,
          undefined,
          this.abort.signal,
        );
        this.nextBatch = sync.next_batch;
        this._status = "connected";
        this._statusDetail = undefined;

        // Accept invites
        const invites = sync.rooms?.invite || {};
        for (const roomId of Object.keys(invites)) {
          try {
            await this.api("POST", `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/join`);
            log("matrix", `joined ${roomId}`);
          } catch (err: any) {
            log.warn("matrix", `failed to join ${roomId}: ${err.message || err}`);
          }
        }

        // Process new messages in joined rooms
        const joins = sync.rooms?.join || {};
        for (const [roomId, room] of Object.entries(joins)) {
          const events = room.timeline?.events || [];
          for (const ev of events) {
            if (ev.type !== "m.room.message") continue;
            if (ev.sender === this.userId) continue; // our own sends
            if (ev.content?.msgtype !== "m.text") continue; // skip media for MVP
            const body = ev.content.body || "";
            if (!body) continue;
            // Fire and forget — don't block the sync loop on a long turn
            this.handleIncoming(roomId, ev.sender, body, onMessage).catch((err) => {
              log.error("matrix", `handle incoming failed: ${err.message || err}`);
            });
          }
        }
      } catch (err: any) {
        if (err.name === "AbortError" || !this.running) break;
        this._status = "error";
        this._statusDetail = err.message || String(err);
        log.warn("matrix", `sync error, retrying in 5s: ${this._statusDetail}`);
        await sleep(5000);
      }
    }
  }

  private async handleIncoming(
    roomId: string,
    sender: string,
    text: string,
    onMessage: StartOptions["onMessage"],
  ): Promise<void> {
    log("matrix", `message from ${sender} in ${roomId}: ${text.slice(0, 80)}`);

    // Pairing: auto-pair first user, gate others
    if (this.pairing && !this.pairing.isPaired(sender)) {
      if (!this.pairing.hasAnyPairedUsers()) {
        await this.pairing.autoPairFirst(sender, "matrix", roomId);
      } else {
        const key = `${sender}:${roomId}`;
        if (this.sentCodes.has(key)) return;
        this.sentCodes.add(key);
        const code = await this.pairing.getOrCreateCode(sender, "matrix", `matrix:${roomId}`);
        await this.sendMessage(
          roomId,
          `${sender} is not paired with this agent.\n\nPairing code: ${code}\n\nShare this code with the agent's operator to approve access.`,
        );
        return;
      }
    }

    // Keep typing indicator alive while the turn runs (Matrix times out at ~30s)
    const typingInterval = setInterval(() => {
      this.setTyping(roomId, true).catch(() => {});
    }, 20000);
    await this.setTyping(roomId, true).catch(() => {});

    try {
      const response = await onMessage(
        {
          text,
          userId: sender,
          chatId: roomId,
          interface: "matrix",
          channel: `matrix:${roomId}`,
        },
        // Ignore stream events for MVP — reply with final text only
        () => {},
      );

      clearInterval(typingInterval);
      await this.setTyping(roomId, false).catch(() => {});

      const reply = (response || "").trim();
      if (!reply || reply === "NO_REPLY" || reply === "(no text response)") return;
      await this.sendMessage(roomId, reply);
    } catch (err: any) {
      clearInterval(typingInterval);
      await this.setTyping(roomId, false).catch(() => {});
      await this.sendMessage(roomId, `Error: ${err.message || err}`).catch(() => {});
    }
  }

  private async sendMessage(roomId: string, body: string): Promise<void> {
    const txnId = `kern-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await this.api(
      "PUT",
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`,
      { msgtype: "m.text", body },
    );
  }

  private async setTyping(roomId: string, typing: boolean): Promise<void> {
    await this.api(
      "PUT",
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/typing/${encodeURIComponent(this.userId)}`,
      typing ? { typing: true, timeout: 30000 } : { typing: false },
    );
  }

  private async api<T = any>(
    method: "GET" | "POST" | "PUT",
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const res = await fetch(`${this.homeserver}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`matrix ${method} ${path} ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.json() as Promise<T>;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Minimal typings for the parts of /sync we care about
interface MatrixSync {
  next_batch: string;
  rooms?: {
    invite?: Record<string, unknown>;
    join?: Record<string, {
      timeline?: { events?: MatrixEvent[] };
    }>;
  };
}

interface MatrixEvent {
  type: string;
  sender: string;
  content?: {
    msgtype?: string;
    body?: string;
  };
}
