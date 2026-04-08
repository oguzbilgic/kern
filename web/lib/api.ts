// Pure API functions — no React, no state
// All agent requests go through the web proxy: /api/agents/{name}/*

import type { StreamEvent, StatusData, HistoryMessage, Attachment } from "./types";

function headers(token?: string | null): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

/** Build proxied base URL for an agent */
export function agentUrl(name: string, serverUrl?: string): string {
  const base = serverUrl || "";
  return `${base}/api/agents/${encodeURIComponent(name)}`;
}

// SSE connection — uses proxied events endpoint
export interface SSEConnection {
  close: () => void;
  connectionId: string | null;
}

export function connectSSE(
  agentName: string,
  token: string | null,
  callbacks: {
    onEvent: (ev: StreamEvent) => void;
    onConnect?: () => void;
    onDisconnect?: () => void;
  },
  serverUrl?: string
): SSEConnection {
  const base = agentUrl(agentName, serverUrl);
  const url = token
    ? `${base}/events?token=${encodeURIComponent(token)}`
    : `${base}/events`;
  const es = new EventSource(url);
  let connectionId: string | null = null;
  let closed = false;

  es.onopen = () => {
    callbacks.onConnect?.();
  };

  es.onmessage = (e) => {
    try {
      const ev: StreamEvent = JSON.parse(e.data);
      if (ev.type === "connection" && ev.connectionId) {
        connectionId = ev.connectionId;
        return;
      }
      callbacks.onEvent(ev);
    } catch { /* ignore */ }
  };

  // Let EventSource auto-reconnect on transient errors.
  // Only call onDisconnect so UI can show status, but don't close.
  es.onerror = () => {
    if (!closed) {
      callbacks.onDisconnect?.();
    }
  };

  return {
    close() {
      closed = true;
      es.close();
    },
    get connectionId() { return connectionId; },
  };
}

// Discovery — returns raw agent list from a server
export interface RawAgent {
  name: string;
  running: boolean;
}

export async function fetchAgents(token?: string | null, serverUrl?: string): Promise<RawAgent[]> {
  const base = serverUrl || "";
  const res = await fetch(`${base}/api/agents`, { headers: headers(token) });
  if (!res.ok) return [];
  return res.json();
}

// Agent REST API — all through proxy
export async function sendMessage(
  agentName: string,
  token: string | null,
  text: string,
  opts: {
    connectionId?: string | null;
    attachments?: Attachment[];
    serverUrl?: string;
  } = {}
): Promise<{ ok: boolean }> {
  const payload: Record<string, unknown> = {
    text,
    userId: "tui",
    interface: "web",
    channel: "web",
    connectionId: opts.connectionId,
  };
  if (opts.attachments?.length) {
    payload.attachments = opts.attachments.map((a) => ({
      type: a.type,
      data: a.base64,
      mimeType: a.mimeType,
      filename: a.filename,
      size: a.size || 0,
    }));
  }
  const res = await fetch(`${agentUrl(agentName, opts.serverUrl)}/message`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function getStatus(agentName: string, token?: string | null, serverUrl?: string): Promise<StatusData> {
  const res = await fetch(`${agentUrl(agentName, serverUrl)}/status`, { headers: headers(token) });
  return res.json();
}

export async function getHistory(agentName: string, token?: string | null, limit = 100, serverUrl?: string): Promise<HistoryMessage[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  const res = await fetch(`${agentUrl(agentName, serverUrl)}/history?${params}`, { headers: headers(token) });
  return res.json();
}

export async function getSystemPrompt(agentName: string, token?: string | null, serverUrl?: string): Promise<string> {
  const res = await fetch(`${agentUrl(agentName, serverUrl)}/context/system`, { headers: headers(token) });
  return res.text();
}

export async function getContextSegments(agentName: string, token?: string | null, serverUrl?: string) {
  const res = await fetch(`${agentUrl(agentName, serverUrl)}/context/segments`, { headers: headers(token) });
  return res.json();
}

export async function getSessions(agentName: string, token?: string | null, serverUrl?: string) {
  const res = await fetch(`${agentUrl(agentName, serverUrl)}/sessions`, { headers: headers(token) });
  return res.json();
}

export async function getSessionActivity(agentName: string, token: string | null, serverUrl?: string, sessionId?: string) {
  const res = await fetch(`${agentUrl(agentName, serverUrl)}/sessions/${sessionId}/activity`, { headers: headers(token) });
  return res.json();
}

export async function getSummaries(agentName: string, token?: string | null, serverUrl?: string) {
  const res = await fetch(`${agentUrl(agentName, serverUrl)}/summaries`, { headers: headers(token) });
  return res.json();
}

export async function regenerateSummary(agentName: string, token?: string | null, serverUrl?: string) {
  const res = await fetch(`${agentUrl(agentName, serverUrl)}/summaries/regenerate`, { method: "POST", headers: headers(token) });
  return res.json();
}

export async function recallSearch(agentName: string, token: string | null, serverUrl?: string, query?: string, limit = 10) {
  const params = new URLSearchParams({ q: query || "", limit: String(limit) });
  const res = await fetch(`${agentUrl(agentName, serverUrl)}/recall/search?${params}`, { headers: headers(token) });
  return res.json();
}

export async function getRecallStats(agentName: string, token?: string | null, serverUrl?: string) {
  const res = await fetch(`${agentUrl(agentName, serverUrl)}/recall/stats`, { headers: headers(token) });
  return res.json();
}

export async function getMediaList(agentName: string, token?: string | null, serverUrl?: string) {
  const res = await fetch(`${agentUrl(agentName, serverUrl)}/media/list`, { headers: headers(token) });
  return res.json();
}

export async function getSegments(agentName: string, token?: string | null, serverUrl?: string) {
  const res = await fetch(`${agentUrl(agentName, serverUrl)}/segments`, { headers: headers(token) });
  return res.json();
}

export async function rebuildSegments(agentName: string, token?: string | null, serverUrl?: string) {
  const res = await fetch(`${agentUrl(agentName, serverUrl)}/segments/rebuild`, { method: "POST", headers: headers(token) });
  return res.json();
}

export async function resummarizeSegment(agentName: string, token: string | null, serverUrl?: string, segmentId?: number) {
  const res = await fetch(`${agentUrl(agentName, serverUrl)}/segments/${segmentId}/resummarize`, { method: "POST", headers: headers(token) });
  return res.json();
}
