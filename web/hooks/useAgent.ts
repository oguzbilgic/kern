"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { AgentInfo, ChatMessage, StreamEvent, Attachment, StatusData } from "../lib/types";
import * as api from "../lib/api";
import { historyToMessages } from "../lib/messages";
import { processStreamEvent } from "../lib/events";

export interface AgentState {
  messages: ChatMessage[];
  streamParts: ChatMessage[];
  thinking: boolean;
  connected: boolean;
  unread: number;
  status: StatusData | null;
  send: (text: string, attachments?: Attachment[]) => Promise<void>;
}

const NOOP_SEND = async () => {};

const EMPTY_STATE: AgentState = {
  messages: [],
  streamParts: [],
  thinking: false,
  connected: false,
  unread: 0,
  status: null,
  send: NOOP_SEND,
};

export function useAgent(
  agent: AgentInfo | null,
  opts: { withHistory: boolean } = { withHistory: false }
): AgentState {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamParts, setStreamParts] = useState<ChatMessage[]>([]);
  const [thinking, setThinking] = useState(false);
  const [connected, setConnected] = useState(false);
  const [unread, setUnread] = useState(0);
  const [status, setStatus] = useState<StatusData | null>(null);

  const sseRef = useRef<api.SSEConnection | null>(null);
  const partsRef = useRef<ChatMessage[]>([]);
  // Track if we're in an active turn (between thinking/tool and finish)
  const inTurnRef = useRef(false);

  const name = agent?.name ?? null;
  const token = agent?.token ?? null;
  const serverUrl = agent?.serverUrl;
  const withHistory = opts.withHistory;

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
    partsRef.current = [];
    setStreamParts([]);
    setThinking(false);
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

          // Thinking: true on turn start, stays true until finish
          if (ev.type === "thinking" || ev.type === "tool-call" || ev.type === "tool-result") {
            inTurnRef.current = true;
            setThinking(true);
          } else if (ev.type === "text-delta") {
            // Text is streaming — keep thinking true (dots hidden by render condition)
            inTurnRef.current = true;
            setThinking(true);
          } else if (ev.type === "finish" || ev.type === "error") {
            inTurnRef.current = false;
            setThinking(false);
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
            inTurnRef.current = false;
            api.getStatus(name!, token, serverUrl).then(setStatus).catch(() => {});
          } else if (result.append.length > 0) {
            setMessages((prev) => [...prev, ...result.append]);
          }
        } else {
          // Light mode: only track thinking + unread for sidebar
          if (ev.type === "thinking" || ev.type === "tool-call" || ev.type === "tool-result") {
            inTurnRef.current = true;
            setThinking(true);
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
    connected,
    unread,
    status,
    send: withHistory ? send : NOOP_SEND,
  };
}
