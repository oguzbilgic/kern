import WebSocket from "ws";
import { sign, ensureKeypair } from "../keys.js";
import { log } from "../log.js";
import type { StartOptions } from "./types.js";
import type { PairingManager } from "../pairing.js";

const HUB_ALIASES: Record<string, string> = {
  default: "ws://hub.kern-ai.com:4000",
  local: "ws://localhost:4000",
};

function resolveHubUrl(hub: string): string {
  if (HUB_ALIASES[hub]) return HUB_ALIASES[hub];
  if (hub.startsWith("ws://") || hub.startsWith("wss://")) return hub;
  return `ws://${hub}`;
}

export class HubInterface {
  private ws: WebSocket | null = null;
  private onMessage: StartOptions["onMessage"] | null = null;
  private agentDir: string;
  private agentName: string;
  private hubUrl: string;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connected = false;
  private myId: string | null = null;
  private pairing: PairingManager;

  constructor(agentDir: string, agentName: string, hubUrl: string, pairing: PairingManager) {
    this.agentDir = agentDir;
    this.agentName = agentName;
    this.hubUrl = resolveHubUrl(hubUrl);
    this.pairing = pairing;
  }

  async start(onMessage: StartOptions["onMessage"]): Promise<void> {
    this.onMessage = onMessage;
    this.connect();
  }

  async stop(): Promise<void> {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  getUrl(): string {
    return this.hubUrl;
  }

  getMyId(): string | null {
    return this.myId;
  }

  private pendingDelivery: { resolve: (v: { ok: boolean; error?: string; detail?: string }) => void } | null = null;

  async sendMessage(userId: string, text: string): Promise<{ ok: boolean; error?: string; detail?: string }> {
    if (!this.ws || !this.connected) return { ok: false, error: "disconnected", detail: "not connected to hub" };
    return new Promise((resolve) => {
      this.pendingDelivery = { resolve };
      this.ws!.send(JSON.stringify({ type: "message", to: userId, text }));
      // Timeout after 5s
      setTimeout(() => {
        if (this.pendingDelivery?.resolve === resolve) {
          this.pendingDelivery = null;
          resolve({ ok: false, error: "timeout", detail: "no response from hub" });
        }
      }, 5000);
    });
  }

  // Send pairing confirmation to another agent
  async sendPairConfirmation(toId: string): Promise<boolean> {
    if (!this.ws || !this.connected || !this.myId) return false;
    this.ws.send(JSON.stringify({
      type: "message",
      to: toId,
      text: `[pair-confirmed] id: ${this.myId}, name: ${this.agentName}`,
    }));
    return true;
  }

  private connect() {
    const keys = ensureKeypair(this.agentDir);

    try {
      this.ws = new WebSocket(this.hubUrl);
    } catch (e: any) {
      log("hub", `connection failed: ${e.message}`);
      this.scheduleReconnect();
      return;
    }

    this.ws.on("open", () => {
      log("hub", `connected to ${this.hubUrl}`);
    });

    this.ws.on("message", (raw) => {
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      switch (msg.type) {
        case "challenge": {
          const signature = sign(keys.privateKey, msg.nonce);
          this.ws!.send(JSON.stringify({
            type: "auth",
            name: this.agentName,
            publicKey: keys.publicKey,
            signature,
          }));
          break;
        }

        case "registered":
          log("hub", `registered as '${msg.name}' (${msg.id})`);
          this.myId = msg.id;
          this.connected = true;
          break;

        case "message": {
          const fromId = msg.from;

          const text = msg.text || "";

          // Handle pairing confirmation from the other side
          const confirmMatch = text.match(/^\[pair-confirmed\] id: ([^,]+), name: (.+)$/);
          if (confirmMatch) {
            const [, confirmId, confirmName] = confirmMatch;
            this.pairing.autoPairFirst(confirmId, "hub", confirmId);
            log("hub", `pairing confirmed: ${confirmName} (${confirmId})`);
            break;
          }

          // Handle pairing-required response (we tried to message an unpaired agent)
          const pairingMatch = text.match(/^\[pairing-required\] code: (.+)$/);
          if (pairingMatch) {
            if (this.onMessage) {
              this.onMessage(
                {
                  text: `Agent ${fromId} requires pairing. Code: ${pairingMatch[1]}. Tell their operator to approve it.`,
                  userId: fromId,
                  chatId: fromId,
                  interface: "hub",
                  channel: "hub",
                },
                () => {},
              );
            }
            break;
          }

          // Check if sender is paired
          if (this.pairing.isPaired(fromId)) {
            if (this.onMessage) {
              this.onMessage(
                {
                  text,
                  userId: fromId,
                  chatId: fromId,
                  interface: "hub",
                  channel: "hub",
                },
                () => {},
              );
            }
          } else {
            // Not paired — generate code, send back
            log("hub", `unpaired message from ${fromId}, generating pairing code`);
            this.pairing.getOrCreateCode(fromId, "hub", "hub").then(code => {
              this.sendMessage(fromId, `[pairing-required] code: ${code}`);
              log("hub", `sent pairing code ${code} to ${fromId}`);
            });
          }
          break;
        }



        case "delivered":
          if (this.pendingDelivery) {
            this.pendingDelivery.resolve({ ok: true });
            this.pendingDelivery = null;
          }
          break;

        case "error":
          log("hub", `error: ${msg.error} — ${msg.detail || ""}`);
          if (this.pendingDelivery) {
            this.pendingDelivery.resolve({ ok: false, error: msg.error, detail: msg.detail });
            this.pendingDelivery = null;
          }
          break;
      }
    });

    this.ws.on("close", () => {
      log("hub", "disconnected");
      this.connected = false;
      this.scheduleReconnect();
    });

    this.ws.on("error", (err) => {
      log("hub", `error: ${err.message}`);
    });
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      log("hub", "reconnecting...");
      this.connect();
    }, 5000);
  }
}
