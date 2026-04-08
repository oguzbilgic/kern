"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { ChatMessage, StreamEvent, Attachment, StatusData } from "../lib/types";
import * as api from "../lib/api";
import { historyToMessages } from "../lib/messages";
import { processStreamEvent } from "../lib/events";

interface UseAgentReturn {
  messages: ChatMessage[];
  streamParts: ChatMessage[];
  thinking: boolean;
  connected: boolean;
  status: StatusData | null;
  send: (text: string, attachments?: Attachment[]) => Promise<void>;
}

export function useAgent(agentName: string | null, token: string | null, serverUrl?: string): UseAgentReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamParts, setStreamParts] = useState<ChatMessage[]>([]);
  const [thinking, setThinking] = useState(false);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<StatusData | null>(null);
  const sseRef = useRef<api.SSEConnection | null>(null);
  const partsRef = useRef<ChatMessage[]>([]);

  const baseUrl = serverUrl || "";

  // Load history + status on agent change
  useEffect(() => {
    if (!agentName) return;
    let cancelled = false;

    async function load() {
      try {
        const [history, statusData] = await Promise.all([
          api.getHistory(agentName!, token, 100, baseUrl || undefined),
          api.getStatus(agentName!, token, baseUrl || undefined),
        ]);
        if (cancelled) return;
        setMessages(historyToMessages(history));
        setStatus(statusData);

        // Detect busy state on load
        if (statusData?.queue && typeof statusData.queue === "string" && statusData.queue.startsWith("busy")) {
          setThinking(true);
        }
      } catch {
        if (!cancelled) setMessages([]);
      }
    }

    setMessages([]);
    partsRef.current = [];
    setStreamParts([]);
    setThinking(false);
    load();

    return () => { cancelled = true; };
  }, [agentName, token, baseUrl]);

  // SSE connection
  useEffect(() => {
    if (!agentName) return;

    const sse = api.connectSSE(agentName, token, {
      onEvent(ev: StreamEvent) {
        const result = processStreamEvent(ev, partsRef.current);

        // Update streaming parts
        partsRef.current = result.parts;
        setStreamParts([...result.parts]);

        // Update thinking state
        if (result.thinking !== null) {
          setThinking(result.thinking);
        }

        // Append completed messages (with delay on flush for final text-delta)
        if (result.flush) {
          setTimeout(() => {
            if (result.append.length > 0) {
              setMessages((prev) => [...prev, ...result.append]);
            }
            partsRef.current = [];
            setStreamParts([]);
            setThinking(false);
            api.getStatus(agentName!, token, baseUrl || undefined).then(setStatus).catch(() => {});
          }, 50);
        } else if (result.append.length > 0) {
          setMessages((prev) => [...prev, ...result.append]);
        }
      },
      onConnect() { setConnected(true); },
      onDisconnect() { setConnected(false); },
    }, baseUrl || undefined);

    sseRef.current = sse;
    return () => {
      sse.close();
      sseRef.current = null;
    };
  }, [agentName, token, baseUrl]);

  const send = useCallback(
    async (text: string, attachments?: Attachment[]) => {
      if (!agentName) return;

      setMessages((prev) => [
        ...prev,
        {
          id: `msg-${Date.now()}`,
          role: "user" as const,
          text,
          timestamp: new Date().toISOString(),
          iface: "web",
        },
      ]);

      setThinking(!text.startsWith("/"));

      await api.sendMessage(agentName, token, text, {
        connectionId: sseRef.current?.connectionId,
        attachments,
        serverUrl: baseUrl || undefined,
      });
    },
    [agentName, token, baseUrl]
  );

  return { messages, streamParts, thinking, connected, status, send };
}
