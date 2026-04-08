// Pure API functions — no React, no state
// All agent requests go through the web proxy: /api/agents/{name}/*

import type { Agent, StreamEvent, StatusData, HistoryMessage, Attachment } from "./types";

function headers(token?: string | null): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

/** Build proxied base URL for an agent */
export function agentUrl(name: string): string {
  return `/api/agents/${encodeURIComponent(name)}`;
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
  }
): SSEConnection {
  const url = token
    ? `${agentUrl(agentName)}/events?token=${encodeURIComponent(token)}`
    : `${agentUrl(agentName)}/events`;
  const es = new EventSource(url);
  let connectionId: string | null = null;

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
    es.close();
    callbacks.onDisconnect?.();
  };

  return {
    close() { es.close(); callbacks.onDisconnect?.(); },
    get connectionId() { return connectionId; },
  };
}

// Discovery
export async function fetchAgents(token?: string | null): Promise<Agent[]> {
  const res = await fetch("/api/agents", { headers: headers(token) });
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
    payload.attachments = opts.attachments;
  }
  const res = await fetch(`${agentUrl(agentName)}/message`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(payload),
  });
  return res.json();
}

export async function getStatus(agentName: string, token?: string | null): Promise<StatusData> {
  const res = await fetch(`${agentUrl(agentName)}/status`, { headers: headers(token) });
  return res.json();
}

export async function getHistory(agentName: string, token?: string | null, limit = 100): Promise<HistoryMessage[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  const res = await fetch(`${agentUrl(agentName)}/history?${params}`, { headers: headers(token) });
  return res.json();
}

export async function getSystemPrompt(agentName: string, token?: string | null): Promise<string> {
  const res = await fetch(`${agentUrl(agentName)}/context/system`, { headers: headers(token) });
  return res.text();
}

export async function getContextSegments(agentName: string, token?: string | null) {
  const res = await fetch(`${agentUrl(agentName)}/context/segments`, { headers: headers(token) });
  return res.json();
}

export async function getSessions(agentName: string, token?: string | null) {
  const res = await fetch(`${agentUrl(agentName)}/sessions`, { headers: headers(token) });
  return res.json();
}

export async function getSessionActivity(agentName: string, token: string | null, sessionId: string) {
  const res = await fetch(`${agentUrl(agentName)}/sessions/${sessionId}/activity`, { headers: headers(token) });
  return res.json();
}

export async function getSummaries(agentName: string, token?: string | null) {
  const res = await fetch(`${agentUrl(agentName)}/summaries`, { headers: headers(token) });
  return res.json();
}

export async function regenerateSummary(agentName: string, token?: string | null) {
  const res = await fetch(`${agentUrl(agentName)}/summaries/regenerate`, { method: "POST", headers: headers(token) });
  return res.json();
}

export async function recallSearch(agentName: string, token: string | null, query: string, limit = 10) {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  const res = await fetch(`${agentUrl(agentName)}/recall/search?${params}`, { headers: headers(token) });
  return res.json();
}

export async function getRecallStats(agentName: string, token?: string | null) {
  const res = await fetch(`${agentUrl(agentName)}/recall/stats`, { headers: headers(token) });
  return res.json();
}

export async function getMediaList(agentName: string, token?: string | null) {
  const res = await fetch(`${agentUrl(agentName)}/media/list`, { headers: headers(token) });
  return res.json();
}

export async function getSegments(agentName: string, token?: string | null) {
  const res = await fetch(`${agentUrl(agentName)}/segments`, { headers: headers(token) });
  return res.json();
}

export async function rebuildSegments(agentName: string, token?: string | null) {
  const res = await fetch(`${agentUrl(agentName)}/segments/rebuild`, { method: "POST", headers: headers(token) });
  return res.json();
}

export async function resummarizeSegment(agentName: string, token: string | null, segmentId: number) {
  const res = await fetch(`${agentUrl(agentName)}/segments/${segmentId}/resummarize`, { method: "POST", headers: headers(token) });
  return res.json();
}
