"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { AgentInfo, ChatMessage, StreamEvent, Attachment, StatusData } from "../lib/types";
import * as api from "../lib/api";
import { historyToMessages } from "../lib/messages";
import { processStreamEvent } from "../lib/events";
import { getPlugins } from "../plugins/registry";

// Map tool names to human-readable activity labels
function toolActivity(toolName?: string): string {
  if (!toolName) return "thinking";
  // Check plugins first
  for (const plugin of getPlugins()) {
    const label = plugin.activityLabel?.(toolName);
    if (label) return label;
  }
  switch (toolName) {
    case "bash": return "running command";
    case "read": return "reading";
    case "write": return "writing";
    case "edit": return "editing";
    case "glob": return "searching files";
    case "grep": return "searching";
    case "webfetch": return "fetching";
    case "websearch": return "searching the web";
    case "recall": return "recalling";
    case "pdf": return "reading PDF";
    case "image": return "analyzing image";
    case "kern": return "checking status";
    case "message": return "sending message";
    default: return `using ${toolName}`;
  }
}

// Extract key argument from tool input for tooltip
function toolDetail(toolName?: string, input?: Record<string, unknown>): string {
  if (!toolName || !input) return "";
  // Check plugins first
  for (const plugin of getPlugins()) {
    const detail = plugin.activityDetail?.(toolName, input);
    if (detail) return detail;
  }
  switch (toolName) {
    case "bash": return truncDetail(String(input.command || ""));
    case "read": return String(input.path || "");
    case "write": return String(input.path || "");
    case "edit": return String(input.path || "");
    case "glob": return String(input.pattern || "");
    case "grep": return String(input.pattern || "");
    case "webfetch": return String(input.url || "");
    case "websearch": return String(input.query || "");
    case "pdf": return String(input.file || "");
    case "image": return String(input.file || "");
    case "recall": return truncDetail(String(input.query || ""));
    case "kern": return String(input.action || "");
    case "message": return String(input.userId || "");
    default: return "";
  }
}

function truncDetail(s: string, max = 80): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

export interface AgentState {
  messages: ChatMessage[];
  streamParts: ChatMessage[];
  thinking: boolean;
  activity: string;
  activityDetail: string;
  connected: boolean;
  unread: number;
  status: StatusData | null;
  send: (text: string, attachments?: Attachment[]) => Promise<void>;
  loadMore: () => Promise<void>;
  hasMore: boolean;
  loadingMore: boolean;
}

const NOOP_SEND = async () => {};

const NOOP_LOAD = async () => {};

const EMPTY_STATE: AgentState = {
  messages: [],
  streamParts: [],
  thinking: false,
  activity: "",
  activityDetail: "",
  connected: false,
  unread: 0,
  status: null,
  send: NOOP_SEND,
  loadMore: NOOP_LOAD,
  hasMore: false,
  loadingMore: false,
};

export function useAgent(
  agent: AgentInfo | null,
  opts: { withHistory: boolean; onOpenPanel?: (html: string, title: string) => void } = { withHistory: false }
): AgentState {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamParts, setStreamParts] = useState<ChatMessage[]>([]);
  const [thinking, setThinking] = useState(false);
  const [activity, setActivity] = useState("");
  const [activityDetail, setActivityDetail] = useState("");
  const [connected, setConnected] = useState(false);
  const [unread, setUnread] = useState(0);
  const [status, setStatus] = useState<StatusData | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const oldestIndexRef = useRef<number | undefined>(undefined);

  const sseRef = useRef<api.SSEConnection | null>(null);
  const partsRef = useRef<ChatMessage[]>([]);
  // Track if we're in an active turn (between thinking/tool and finish)
  const inTurnRef = useRef(false);

  const name = agent?.name ?? null;
  const token = agent?.token ?? null;
  const serverUrl = agent?.serverUrl;
  const withHistory = opts.withHistory;
  const onOpenPanel = opts.onOpenPanel;

  // Load history + status on agent change (only when withHistory)
  useEffect(() => {
    if (!name || !withHistory) return;
    let cancelled = false;

    async function load() {
      try {
        const [history, statusData] = await Promise.all([
          api.getHistory(name!, token, 100, serverUrl),
          api.getStatus(name!, token, serverUrl),
        ]);
        if (cancelled) return;
        setMessages(historyToMessages(history));
        setStatus(statusData);

        // Track oldest index for pagination
        const firstIdx = history[0]?.index;
        oldestIndexRef.current = firstIdx;
        setHasMore(firstIdx !== undefined && firstIdx > 0);

        // Detect busy state on load
        if (statusData?.queue && typeof statusData.queue === "string" && statusData.queue.startsWith("busy")) {
          setThinking(true);
          inTurnRef.current = true;
        }
      } catch {
        if (!cancelled) setMessages([]);
      }
    }

    setMessages([]);
    setUnread(0);
    setHasMore(false);
    oldestIndexRef.current = undefined;
    partsRef.current = [];
    setStreamParts([]);
    setThinking(false);
    setActivity("");
    inTurnRef.current = false;
    load();

    return () => { cancelled = true; };
  }, [name, token, serverUrl, withHistory]);

  // Reset unread when becoming active (withHistory)
  useEffect(() => {
    if (withHistory) setUnread(0);
  }, [name, withHistory]);

  // SSE connection — always active for running agents
  useEffect(() => {
    if (!name) return;

    const sse = api.connectSSE(name, token, {
      onEvent(ev: StreamEvent) {
        if (withHistory) {
          // Full mode: process streaming parts
          const result = processStreamEvent(ev, partsRef.current, inTurnRef.current);

          partsRef.current = result.parts;
          setStreamParts([...result.parts]);

          // Auto-open/refresh panel for panel-target renders
          if (result.panelRender && onOpenPanel) {
            onOpenPanel(result.panelRender.html, result.panelRender.title);
          }

          // Thinking + activity tracking
          if (ev.type === "thinking") {
            inTurnRef.current = true;
            setThinking(true);
            setActivity("thinking");
            setActivityDetail("");
          } else if (ev.type === "tool-call") {
            inTurnRef.current = true;
            setThinking(true);
            setActivity(toolActivity(ev.toolName));
            setActivityDetail(toolDetail(ev.toolName, ev.toolInput as Record<string, unknown>));
          } else if (ev.type === "tool-result") {
            inTurnRef.current = true;
            setThinking(true);
            // Keep current tool activity visible
          } else if (ev.type === "text-delta") {
            inTurnRef.current = true;
            setThinking(true);
          } else if (ev.type === "finish" || ev.type === "error") {
            inTurnRef.current = false;
            setThinking(false);
            setActivity("");
            setActivityDetail("");
          }

          // Append completed messages
          if (result.flush) {
            // Flush atomically — append to messages and clear stream in one batch
            // to prevent layout jump from content disappearing then reappearing
            if (result.append.length > 0) {
              setMessages((prev) => [...prev, ...result.append]);
            }
            partsRef.current = [];
            setStreamParts([]);
            setThinking(false);
            setActivity("");
            setActivityDetail("");
            inTurnRef.current = false;
            api.getStatus(name!, token, serverUrl).then(setStatus).catch(() => {});
          } else if (result.append.length > 0) {
            setMessages((prev) => [...prev, ...result.append]);
          }
        } else {
          // Light mode: only track thinking + unread for sidebar
          if (ev.type === "thinking") {
            inTurnRef.current = true;
            setThinking(true);
            setActivity("thinking");
            setActivityDetail("");
          } else if (ev.type === "tool-call") {
            inTurnRef.current = true;
            setThinking(true);
            setActivity(toolActivity(ev.toolName));
            setActivityDetail(toolDetail(ev.toolName, ev.toolInput as Record<string, unknown>));
          } else if (ev.type === "tool-result") {
            inTurnRef.current = true;
            setThinking(true);
            // Keep current tool activity visible
          } else if (ev.type === "text-delta") {
            inTurnRef.current = true;
            setThinking(true);
          } else if (ev.type === "finish") {
            inTurnRef.current = false;
            setThinking(false);
            // Don't count NO_REPLY, empty, or active agent responses as unread
            if (!withHistory) {
              const resp = ev.text?.trim() || "";
              if (resp && resp !== "NO_REPLY" && resp !== "(no text response)") {
                setUnread((n) => n + 1);
              }
            }
          } else if (ev.type === "error") {
            inTurnRef.current = false;
            setThinking(false);
          }
        }
      },
      onConnect() {
        setConnected(true);
      },
      onDisconnect() {
        setConnected(false);
      },
    }, serverUrl);

    sseRef.current = sse;
    return () => {
      sse.close();
      sseRef.current = null;
    };
  }, [name, token, serverUrl, withHistory]);

  const loadMore = useCallback(
    async () => {
      if (!name || !withHistory || oldestIndexRef.current === undefined || oldestIndexRef.current <= 0 || loadingMore) return;
      setLoadingMore(true);
      try {
        const history = await api.getHistory(name, token, 100, serverUrl, oldestIndexRef.current);
        if (history.length === 0) {
          setHasMore(false);
          return;
        }
        const firstIdx = history[0]?.index;
        oldestIndexRef.current = firstIdx;
        setHasMore(firstIdx !== undefined && firstIdx > 0);
        const older = historyToMessages(history);
        setMessages((prev) => [...older, ...prev]);
      } catch {
        // silently fail
      } finally {
        setLoadingMore(false);
      }
    },
    [name, token, serverUrl, withHistory, loadingMore]
  );

  const send = useCallback(
    async (text: string, attachments?: Attachment[]) => {
      if (!name) return;

      // Append user message to chat (with media preview from attachments)
      const media: import("../lib/types").MediaItem[] | undefined =
        attachments?.length
          ? attachments
              .filter((a) => a.dataUrl)
              .map((a) => ({
                type: (a.type === "image" ? "image" : "file") as "image" | "file",
                url: a.dataUrl!,
                filename: a.filename,
              }))
          : undefined;
      setMessages((prev) => [
        ...prev,
        {
          id: `msg-${Date.now()}`,
          role: "user" as const,
          text,
          timestamp: new Date().toISOString(),
          iface: "web",
          media: media?.length ? media : undefined,
        },
      ]);

      // Show thinking immediately for non-slash commands
      if (!text.startsWith("/")) {
        setThinking(true);
        setActivity("thinking");
        inTurnRef.current = true;
      }

      await api.sendMessage(name, token, text, {
        connectionId: sseRef.current?.connectionId,
        attachments,
        serverUrl,
      });
    },
    [name, token, serverUrl]
  );

  if (!agent) return EMPTY_STATE;

  return {
    messages,
    streamParts,
    thinking,
    activity,
    activityDetail,
    connected,
    unread,
    status,
    send: withHistory ? send : NOOP_SEND,
    loadMore: withHistory ? loadMore : NOOP_LOAD,
    hasMore,
    loadingMore,
  };
}
