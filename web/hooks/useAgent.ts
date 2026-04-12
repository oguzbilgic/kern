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
  opts: { withHistory: boolean } = { withHistory: false }
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
  // Buffer messages that arrive mid-turn (user sends, incoming from other clients)
  // so they appear after the agent's in-progress response, not above it
  const midTurnRef = useRef<ChatMessage[]>([]);

  const baseUrl = agent?.baseUrl ?? null;
  const token = agent?.token ?? null;
  const withHistory = opts.withHistory;

  // Load history + status on agent change (only when withHistory)
  useEffect(() => {
    if (!baseUrl || !withHistory) return;
    let cancelled = false;

    async function load() {
      try {
        const [history, statusData] = await Promise.all([
          api.getHistory(baseUrl!, token, 100),
          api.getStatus(baseUrl!, token),
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
    midTurnRef.current = [];
    setStreamParts([]);
    setThinking(false);
    setActivity("");
    inTurnRef.current = false;
    load();

    return () => { cancelled = true; };
  }, [baseUrl, token, withHistory]);

  // Reset unread on agent change
  useEffect(() => {
    setUnread(0);
  }, [baseUrl]);

  // SSE connection — always active for running agents
  useEffect(() => {
    if (!baseUrl) return;

    const sse = api.connectSSE(baseUrl, token, {
      onEvent(ev: StreamEvent) {
        if (withHistory) {
          // Full mode: process streaming parts
          const result = processStreamEvent(ev, partsRef.current, inTurnRef.current);

          partsRef.current = result.parts;
          // Always append buffered mid-turn messages after streaming parts
          setStreamParts([...result.parts, ...midTurnRef.current]);

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
            inTurnRef.current = false; // Reset so next text segment counts as new message
            setThinking(true);
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
            // Flush: agent response first, then any mid-turn messages (chronological)
            const midTurn = [...midTurnRef.current];
            midTurnRef.current = [];
            if (result.append.length > 0 || midTurn.length > 0) {
              setMessages((prev) => [...prev, ...result.append, ...midTurn]);
            }
            partsRef.current = [];
            setStreamParts([]);
            setThinking(false);
            setActivity("");
            setActivityDetail("");
            inTurnRef.current = false;
            api.getStatus(baseUrl!, token).then(setStatus).catch(() => {});
          } else if (result.append.length > 0) {
            if (inTurnRef.current) {
              // Mid-turn: buffer messages to appear after streaming response
              midTurnRef.current.push(...result.append);
              setStreamParts([...partsRef.current, ...midTurnRef.current]);
            } else {
              // Turn ended (e.g. error) or not in turn: flush mid-turn buffer too
              const midTurn = [...midTurnRef.current];
              midTurnRef.current = [];
              setMessages((prev) => [...prev, ...midTurn, ...result.append]);
              setStreamParts([...partsRef.current]);
            }
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
            inTurnRef.current = false;
            setThinking(true);
          } else if (ev.type === "text-delta") {
            if (!withHistory && !inTurnRef.current) {
              setUnread((n) => n + 1);
            }
            inTurnRef.current = true;
            setThinking(true);
          } else if (ev.type === "incoming") {
            if (!withHistory) {
              const text = ev.text?.trim() || "";
              if (text) setUnread((n) => n + 1);
            }
          } else if (ev.type === "finish") {
            inTurnRef.current = false;
            setThinking(false);
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
    });

    sseRef.current = sse;
    return () => {
      sse.close();
      sseRef.current = null;
    };
  }, [baseUrl, token, withHistory]);

  const loadMore = useCallback(
    async () => {
      if (!baseUrl || !withHistory || oldestIndexRef.current === undefined || oldestIndexRef.current <= 0 || loadingMore) return;
      setLoadingMore(true);
      try {
        const history = await api.getHistory(baseUrl, token, 100, oldestIndexRef.current);
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
    [baseUrl, token, withHistory, loadingMore]
  );

  const send = useCallback(
    async (text: string, attachments?: Attachment[]) => {
      if (!baseUrl) return;

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
      const userMsg: ChatMessage = {
        id: `msg-${Date.now()}`,
        role: "user" as const,
        text,
        timestamp: new Date().toISOString(),
        iface: "web",
        media: media?.length ? media : undefined,
      };

      if (inTurnRef.current) {
        // Mid-turn: buffer message to appear after the agent's in-progress response
        midTurnRef.current.push(userMsg);
        setStreamParts([...partsRef.current, ...midTurnRef.current]);
      } else {
        setMessages((prev) => [...prev, userMsg]);
      }

      // Show thinking immediately for non-slash commands
      if (!text.startsWith("/")) {
        setThinking(true);
        setActivity("thinking");
        inTurnRef.current = true;
      }

      await api.sendMessage(baseUrl, token, text, {
        connectionId: sseRef.current?.connectionId,
        attachments,
      });
    },
    [baseUrl, token]
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
