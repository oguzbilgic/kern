// Pure API functions — no React, no state
// All requests use a resolved baseUrl (proxy or direct — caller doesn't care)

import type { StreamEvent, StatusData, HistoryMessage, Attachment } from "./types";

function headers(token?: string | null): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

// SSE connection
export interface SSEConnection {
  close: () => void;
  connectionId: string | null;
}

export function connectSSE(
  baseUrl: string,
  token: string | null,
  callbacks: {
    onEvent: (ev: StreamEvent) => void;
    onConnect?: () => void;
    onDisconnect?: () => void;
  },
): SSEConnection {
  const url = token
    ? `${baseUrl}/events?token=${encodeURIComponent(token)}`
    : `${baseUrl}/events`;
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

// Discovery — returns raw agent list from a proxy server
export interface RawAgent {
  name: string;
  running: boolean;
}

export async function fetchAgents(serverUrl: string, token: string): Promise<RawAgent[]> {
  const res = await fetch(`${serverUrl}/api/agents`, { headers: headers(token) });
  if (!res.ok) return [];
  return res.json();
}

// Check if a direct agent is reachable
export async function pingAgent(baseUrl: string, token: string): Promise<StatusData | null> {
  try {
    const res = await fetch(`${baseUrl}/status`, { headers: headers(token) });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

// Agent REST API — all use resolved baseUrl
export async function sendMessage(
  baseUrl: string,
  token: string | null,
  text: string,
  opts: {
    connectionId?: string | null;
    attachments?: Attachment[];
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
  const res = await fetch(`${baseUrl}/message`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function getStatus(baseUrl: string, token?: string | null): Promise<StatusData> {
  const res = await fetch(`${baseUrl}/status`, { headers: headers(token) });
  return res.json();
}

export async function getHistory(baseUrl: string, token?: string | null, limit = 100, before?: number): Promise<HistoryMessage[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (before !== undefined) params.set("before", String(before));
  const res = await fetch(`${baseUrl}/history?${params}`, { headers: headers(token) });
  return res.json();
}

export async function getSystemPrompt(baseUrl: string, token?: string | null): Promise<string> {
  const res = await fetch(`${baseUrl}/context/system`, { headers: headers(token) });
  return res.text();
}

export async function getContextSegments(baseUrl: string, token?: string | null) {
  const res = await fetch(`${baseUrl}/context/segments`, { headers: headers(token) });
  return res.json();
}

export async function getSessions(baseUrl: string, token?: string | null) {
  const res = await fetch(`${baseUrl}/sessions`, { headers: headers(token) });
  return res.json();
}

export async function getSessionActivity(baseUrl: string, token: string | null, sessionId?: string) {
  const res = await fetch(`${baseUrl}/sessions/${sessionId}/activity`, { headers: headers(token) });
  return res.json();
}

export async function getSummaries(baseUrl: string, token?: string | null) {
  const res = await fetch(`${baseUrl}/summaries`, { headers: headers(token) });
  return res.json();
}

export async function regenerateSummary(baseUrl: string, token?: string | null) {
  const res = await fetch(`${baseUrl}/summaries/regenerate`, { method: "POST", headers: headers(token) });
  return res.json();
}

export async function recallSearch(baseUrl: string, token: string | null, query?: string, limit = 10) {
  const params = new URLSearchParams({ q: query || "", limit: String(limit) });
  const res = await fetch(`${baseUrl}/recall/search?${params}`, { headers: headers(token) });
  return res.json();
}

export async function getRecallStats(baseUrl: string, token?: string | null) {
  const res = await fetch(`${baseUrl}/recall/stats`, { headers: headers(token) });
  return res.json();
}

export async function getMediaList(baseUrl: string, token?: string | null) {
  const res = await fetch(`${baseUrl}/media/list`, { headers: headers(token) });
  return res.json();
}

export async function getSegments(baseUrl: string, token?: string | null) {
  const res = await fetch(`${baseUrl}/segments`, { headers: headers(token) });
  return res.json();
}

export async function rebuildSegments(baseUrl: string, token?: string | null) {
  const res = await fetch(`${baseUrl}/segments/rebuild`, { method: "POST", headers: headers(token) });
  return res.json();
}

export async function resummarizeSegment(baseUrl: string, token: string | null, segmentId?: number) {
  const res = await fetch(`${baseUrl}/segments/${segmentId}/resummarize`, { method: "POST", headers: headers(token) });
  return res.json();
}

export async function getCommands(baseUrl: string, token?: string | null): Promise<Record<string, string>> {
  try {
    const res = await fetch(`${baseUrl}/commands`, { headers: headers(token) });
    if (!res.ok) return {};
    return res.json();
  } catch {
    return {};
  }
}
