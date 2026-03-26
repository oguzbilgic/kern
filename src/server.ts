import { createServer, type IncomingMessage, type ServerResponse } from "http";
import type { StreamEvent } from "./runtime.js";
import { log } from "./log.js";

export interface ServerEvent extends StreamEvent {
  // Extends StreamEvent with cross-channel messages
  fromInterface?: string;
  fromUserId?: string;
  fromChannel?: string;
}

type SSEClient = {
  res: ServerResponse;
};

export class AgentServer {
  private server: ReturnType<typeof createServer>;
  private clients: SSEClient[] = [];
  private onMessage: ((text: string, userId: string, iface: string, channel: string) => Promise<void>) | null = null;
  private statusFn: (() => any) | null = null;
  private historyFn: ((limit: number, before?: number) => any[]) | null = null;
  private port = 0;

  constructor() {
    this.server = createServer((req, res) => this.handleRequest(req, res));
  }

  setMessageHandler(handler: (text: string, userId: string, iface: string, channel: string) => Promise<void>) {
    this.onMessage = handler;
  }

  setStatusFn(fn: () => any) {
    this.statusFn = fn;
  }

  setHistoryFn(fn: (limit: number, before?: number) => any[]) {
    this.historyFn = fn;
  }

  async start(): Promise<number> {
    return new Promise((resolve) => {
      this.server.listen(0, "127.0.0.1", () => {
        this.port = (this.server.address() as any).port;
        log("server", `listening on :${this.port}`);
        resolve(this.port);
      });
    });
  }

  stop() {
    for (const client of this.clients) {
      client.res.end();
    }
    this.clients = [];
    this.server.close();
  }

  // Broadcast event to all SSE clients
  broadcast(event: ServerEvent) {
    const data = JSON.stringify(event);
    for (const client of this.clients) {
      try {
        client.res.write(`data: ${data}\n\n`);
      } catch {
        // client disconnected
      }
    }
  }

  getPort(): number {
    return this.port;
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse) {
    // CORS for potential web UI
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    const url = req.url || "/";

    // SSE endpoint — stream all events
    if (url === "/events" && req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });
      res.write(":\n\n"); // SSE comment to establish connection

      // Keepalive ping every 15s to prevent body timeout
      const keepalive = setInterval(() => {
        try { res.write(":\n\n"); } catch {}
      }, 15000);

      const client: SSEClient = { res };
      this.clients.push(client);
      log("server", `SSE client connected (${this.clients.length} total)`);

      req.on("close", () => {
        clearInterval(keepalive);
        this.clients = this.clients.filter((c) => c !== client);
        log("server", `SSE client disconnected (${this.clients.length} total)`);
      });
      return;
    }

    // Post a message
    if (url === "/message" && req.method === "POST") {
      const body = await readBody(req);
      try {
        const { text, userId, interface: iface, channel } = JSON.parse(body);
        if (!text) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "text required" }));
          return;
        }
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));

        // Handle async — don't await, response already sent
        if (this.onMessage) {
          this.onMessage(text, userId || "tui", iface || "tui", channel || "tui").catch(() => {});
        }
      } catch {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "invalid JSON" }));
      }
      return;
    }

    // Status
    if (url === "/status" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(this.statusFn ? this.statusFn() : {}));
      return;
    }

    // History — ?limit=50&before=<index>
    if (url?.startsWith("/history") && req.method === "GET") {
      const params = new URL(url, "http://localhost").searchParams;
      const limit = parseInt(params.get("limit") || "50", 10);
      const beforeStr = params.get("before");
      const before = beforeStr ? parseInt(beforeStr, 10) : undefined;
      const history = this.historyFn ? this.historyFn(limit, before) : [];
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(history));
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: "not found" }));
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
  });
}
