import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { join } from "path";
import { existsSync, readFileSync } from "fs";
import type { StreamEvent } from "./runtime.js";
import type { Attachment } from "./interfaces/types.js";
import { log } from "./log.js";

export interface ServerEvent extends StreamEvent {
  // Extends StreamEvent with cross-channel messages
  fromInterface?: string;
  fromUserId?: string;
  fromChannel?: string;
  fromClientId?: string;
  command?: string;
}

type SSEClient = {
  id: string;
  res: ServerResponse;
};

export class AgentServer {
  private server: ReturnType<typeof createServer>;
  private clients: SSEClient[] = [];
  private onMessage: ((text: string, userId: string, iface: string, channel: string, attachments?: Attachment[]) => Promise<void>) | null = null;
  private statusFn: (() => any | Promise<any>) | null = null;
  private historyFn: ((limit: number, before?: number) => any[]) | null = null;
  private segmentsFn: ((sessionId?: string) => any) | null = null;
  private contextSegmentsFn: (() => any | Promise<any>) | null = null;
  private systemPromptFn: (() => any | Promise<any>) | null = null;
  private segmentsRebuildFn: (() => Promise<any>) | null = null;
  private segmentsStopFn: (() => void) | null = null;
  private segmentsCleanFn: (() => void) | null = null;
  private segmentsStartFn: (() => Promise<any>) | null = null;
  private segmentResummarizeFn: ((id: number) => Promise<any>) | null = null;
  private summariesFn: (() => any) | null = null;
  private summaryRegenerateFn: (() => Promise<any>) | null = null;
  private recallSearchFn: ((query: string, limit: number) => Promise<any>) | null = null;
  private recallStatsFn: (() => any) | null = null;
  private sessionListFn: (() => any) | null = null;
  private sessionActivityFn: ((sessionId: string) => any) | null = null;
  private currentSessionIdFn: (() => string | null) | null = null;
  private port = 0;
  private agentDir = "";

  constructor() {
    this.server = createServer((req, res) => this.handleRequest(req, res));
  }

  setAgentDir(dir: string) {
    this.agentDir = dir;
  }

  setMessageHandler(handler: (text: string, userId: string, iface: string, channel: string, attachments?: Attachment[]) => Promise<void>) {
    this.onMessage = handler;
  }

  setStatusFn(fn: () => any) {
    this.statusFn = fn;
  }

  setHistoryFn(fn: (limit: number, before?: number) => any[]) {
    this.historyFn = fn;
  }

  setSegmentsFn(fn: (sessionId?: string) => any) {
    this.segmentsFn = fn;
  }

  setContextSegmentsFn(fn: () => any | Promise<any>) {
    this.contextSegmentsFn = fn;
  }

  setSystemPromptFn(fn: () => any | Promise<any>) {
    this.systemPromptFn = fn;
  }

  setSegmentsRebuildFn(fn: () => Promise<any>) {
    this.segmentsRebuildFn = fn;
  }

  setSegmentsStopFn(fn: () => void) {
    this.segmentsStopFn = fn;
  }

  setSegmentsCleanFn(fn: () => void) {
    this.segmentsCleanFn = fn;
  }

  setSegmentsStartFn(fn: () => Promise<any>) {
    this.segmentsStartFn = fn;
  }

  setSegmentResummarizeFn(fn: (id: number) => Promise<any>) {
    this.segmentResummarizeFn = fn;
  }

  setSummariesFn(fn: () => any) {
    this.summariesFn = fn;
  }

  setSummaryRegenerateFn(fn: () => Promise<any>) {
    this.summaryRegenerateFn = fn;
  }

  setRecallSearchFn(fn: (query: string, limit: number) => Promise<any>) {
    this.recallSearchFn = fn;
  }

  setRecallStatsFn(fn: () => any) {
    this.recallStatsFn = fn;
  }

  setSessionListFn(fn: () => any) {
    this.sessionListFn = fn;
  }

  setSessionActivityFn(fn: (sessionId: string) => any) {
    this.sessionActivityFn = fn;
  }

  setCurrentSessionIdFn(fn: () => string | null) {
    this.currentSessionIdFn = fn;
  }

  async start(host: string = "127.0.0.1"): Promise<number> {
    return new Promise((resolve) => {
      this.server.listen(0, host, () => {
        this.port = (this.server.address() as any).port;
        log("server", `listening on ${host}:${this.port}`);
        resolve(this.port);
      });
    });
  }

  hasConnectedClients(): boolean {
    return this.clients.length > 0;
  }

  stop() {
    for (const client of this.clients) {
      client.res.end();
    }
    this.clients = [];
    this.server.close();
  }

  // Broadcast event to all SSE clients (optionally skip one connection)
  broadcast(event: ServerEvent, excludeConnectionId?: string) {
    const data = JSON.stringify(event);
    for (const client of this.clients) {
      if (excludeConnectionId && client.id === excludeConnectionId) continue;
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

  private isHeartbeat(text: string): boolean {
    return text === "[heartbeat]" || text.startsWith("[heartbeat");
  }

  private checkAuth(req: IncomingMessage): boolean {
    const token = process.env.KERN_AUTH_TOKEN;
    if (!token) return true; // shouldn't happen — token is always generated

    // Check Authorization: Bearer header
    const authHeader = req.headers.authorization;
    if (authHeader === `Bearer ${token}`) return true;

    // Check ?token= query param (for EventSource — can't set headers)
    const url = new URL(req.url || "/", "http://localhost");
    if (url.searchParams.get("token") === token) return true;

    return false;
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse) {
    // CORS for web UI
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    const rawUrl = req.url || "/";
    const url = rawUrl.split("?")[0]; // strip query string for route matching

    // Health check — always public (for monitoring)
    if (url === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, uptime: process.uptime() }));
      return;
    }

    // Auth check — all other endpoints require token
    if (!this.checkAuth(req)) {
      const remote = req.socket.remoteAddress || "unknown";
      log("server", `401 unauthorized: ${req.method} ${url} from ${remote}`);
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }

    // SSE endpoint — stream all events
    if (url === "/events" && req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      });
      // Assign a connection ID and send it as the first event
      const connectionId = crypto.randomUUID().slice(0, 8);
      res.write(`data: ${JSON.stringify({ type: "connection", connectionId })}\n\n`);

      // Keepalive ping every 15s to prevent body timeout
      const keepalive = setInterval(() => {
        try { res.write(":\n\n"); } catch {}
      }, 15000);

      const client: SSEClient = { id: connectionId, res };
      this.clients.push(client);
      const remote = req.socket.remoteAddress || "unknown";
      log("server", `SSE client connected from ${remote} (id=${connectionId}, ${this.clients.length} total)`);

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
        const { text, userId, interface: iface, channel, connectionId, attachments: rawAttachments } = JSON.parse(body);
        if (!text && (!rawAttachments || rawAttachments.length === 0)) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "text or attachments required" }));
          return;
        }
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true }));

        // Parse base64-encoded attachments from web clients
        let attachments: Attachment[] | undefined;
        if (rawAttachments && Array.isArray(rawAttachments) && rawAttachments.length > 0) {
          attachments = rawAttachments.map((att: any) => ({
            type: att.type || "document",
            data: Buffer.from(att.data, "base64"),
            mimeType: att.mimeType || "application/octet-stream",
            filename: att.filename,
            size: att.size || 0,
          }));
          log("server", `received ${attachments.length} attachment(s) from web`);
        }

        // Broadcast incoming to all OTHER clients (exclude sender)
        if (!this.isHeartbeat(text || "")) {
          const excludeId = connectionId || undefined;
          log("server", `incoming broadcast: interface=${iface || "web"} user=${userId || "tui"} exclude=${excludeId || "none"} clients=${this.clients.length}`);
          this.broadcast({
            type: "incoming" as any,
            text: text || "[media]",
            fromInterface: iface || "web",
            fromUserId: userId || "tui",
            fromChannel: channel || "web",
          }, excludeId);
        }

        // Handle async — don't await, response already sent
        if (this.onMessage) {
          this.onMessage(text || "[media]", userId || "tui", iface || "tui", channel || "tui", attachments).catch(() => {});
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
    if (url === "/history" && req.method === "GET") {
      const params = new URL(rawUrl, "http://localhost").searchParams;
      const limit = parseInt(params.get("limit") || "50", 10);
      const beforeStr = params.get("before");
      const before = beforeStr ? parseInt(beforeStr, 10) : undefined;
      const history = this.historyFn ? this.historyFn(limit, before) : [];
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(history));
      return;
    }

    // Segments — semantic segment DAG data
    if (url === "/segments" && req.method === "GET") {
      const data = this.segmentsFn ? this.segmentsFn() : { segments: [], stats: {} };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
      return;
    }

    // Context system prompt debug dump
    if (url === "/context/system" && req.method === "GET") {
      const data = this.systemPromptFn ? await this.systemPromptFn() : { system: "" };
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(typeof data === "string" ? data : (data.system || ""));
      return;
    }

    // Context-selected segments currently used for history injection
    if (url === "/context/segments" && req.method === "GET") {
      const data = this.contextSegmentsFn ? await this.contextSegmentsFn() : { segments: [], tokenCount: 0 };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
      return;
    }

    // Segments start — index new messages (no clear)
    if (url === "/segments/start" && req.method === "POST") {
      if (!this.segmentsStartFn) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "segments not enabled" }));
        return;
      }
      this.segmentsStartFn().catch(() => {});
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "started" }));
      return;
    }

    // Segments rebuild — clear and re-index
    if (url === "/segments/rebuild" && req.method === "POST") {
      if (!this.segmentsRebuildFn) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "segments not enabled" }));
        return;
      }
      // Non-blocking — start rebuild, return immediately
      this.segmentsRebuildFn().catch(() => {});
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "rebuilding" }));
      return;
    }

    // Segments stop — abort running rebuild/summarization
    if (url === "/segments/stop" && req.method === "POST") {
      if (this.segmentsStopFn) {
        this.segmentsStopFn();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "stopped" }));
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "segments not enabled" }));
      }
      return;
    }

    // Segments clean — stop + clear all segments
    if (url === "/segments/clean" && req.method === "POST") {
      if (this.segmentsStopFn && this.segmentsCleanFn) {
        this.segmentsStopFn();
        this.segmentsCleanFn();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "cleaned" }));
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "segments not enabled" }));
      }
      return;
    }

    // Segment resummarize — regenerate one segment summary in place
    const resummarizeMatch = url.match(/^\/segments\/(\d+)\/resummarize$/);
    if (resummarizeMatch && req.method === "POST") {
      if (!this.segmentResummarizeFn) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "segments not enabled" }));
        return;
      }
      try {
        const id = parseInt(resummarizeMatch[1] || "", 10);
        if (!Number.isFinite(id)) throw new Error("invalid segment id");
        const result = await this.segmentResummarizeFn(id);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err: any) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message || "resummarize failed" }));
      }
      return;
    }

    // Notes summaries — list all cached summaries
    if (url === "/summaries" && req.method === "GET") {
      const data = this.summariesFn ? this.summariesFn() : [];
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
      return;
    }

    // Notes summary regenerate
    if (url === "/summaries/regenerate" && req.method === "POST") {
      if (!this.summaryRegenerateFn) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "summaries not available" }));
        return;
      }
      try {
        const result = await this.summaryRegenerateFn();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err: any) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message || "regeneration failed" }));
      }
      return;
    }

    // Recall stats
    if (url === "/recall/stats" && req.method === "GET") {
      if (!this.recallStatsFn) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ enabled: false }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ enabled: true, ...this.recallStatsFn() }));
      return;
    }

    // Recall search preview
    if (url === "/recall/search" && req.method === "GET") {
      if (!this.recallSearchFn) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "recall not enabled" }));
        return;
      }
      const params = new URL(rawUrl, "http://localhost").searchParams;
      const query = params.get("q") || "";
      const limit = parseInt(params.get("limit") || "10", 10);
      if (!query) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "q parameter required" }));
        return;
      }
      try {
        const results = await this.recallSearchFn(query, limit);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(results));
      } catch (err: any) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message || "search failed" }));
      }
      return;
    }

    // Sessions list with stats
    if (url === "/sessions" && req.method === "GET") {
      const sessions = this.sessionListFn ? this.sessionListFn() : [];
      const currentSessionId = this.currentSessionIdFn ? this.currentSessionIdFn() : null;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ sessions, currentSessionId }));
      return;
    }

    // Session activity (daily + hourly)
    const sessionActivityMatch = url.match(/^\/sessions\/([^/]+)\/activity$/);
    if (sessionActivityMatch && req.method === "GET") {
      if (!this.sessionActivityFn) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not available" }));
        return;
      }
      const data = this.sessionActivityFn(sessionActivityMatch[1]);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
      return;
    }

    // Serve media files: GET /media/:filename
    const mediaMatch = url.match(/^\/media\/([a-f0-9]+\.[a-z0-9]+)$/);
    if (mediaMatch && req.method === "GET") {
      const filename = mediaMatch[1];
      const mediaPath = join(this.agentDir, ".kern", "media", filename);
      if (existsSync(mediaPath)) {
        const data = readFileSync(mediaPath);
        const ext = filename.split(".").pop() || "";
        const mimeMap: Record<string, string> = {
          jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
          webp: "image/webp", svg: "image/svg+xml", pdf: "application/pdf",
          mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav", m4a: "audio/mp4",
          mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
        };
        res.writeHead(200, {
          "Content-Type": mimeMap[ext] || "application/octet-stream",
          "Cache-Control": "public, max-age=31536000, immutable",
        });
        res.end(data);
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: "media not found" }));
      }
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
