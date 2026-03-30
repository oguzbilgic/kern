import WebSocket from "ws";
import { sign, ensureKeypair } from "../keys.js";
import { log } from "../log.js";
import type { StartOptions } from "./types.js";

export class HubInterface {
  private ws: WebSocket | null = null;
  private onMessage: StartOptions["onMessage"] | null = null;
  private agentDir: string;
  private agentName: string;
  private hubUrl: string;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connected = false;

  constructor(agentDir: string, agentName: string, hubUrl: string) {
    this.agentDir = agentDir;
    this.agentName = agentName;
    this.hubUrl = hubUrl;
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

  async sendMessage(userId: string, text: string): Promise<boolean> {
    if (!this.ws || !this.connected) return false;
    this.ws.send(JSON.stringify({ type: "message", to: userId, text }));
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
          log("hub", `registered as '${msg.name}'`);
          this.connected = true;
          break;

        case "message":
          if (this.onMessage) {
            this.onMessage(
              {
                text: msg.text,
                userId: msg.from,
                chatId: msg.from,
                interface: "hub",
                channel: "hub",
              },
              () => {},
            );
          }
          break;

        case "delivered":
          break;

        case "error":
          log("hub", `error: ${msg.error}`);
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
