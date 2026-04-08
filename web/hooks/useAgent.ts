"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { Agent, ChatMessage, StreamEvent, Attachment, StatusData } from "../lib/types";
import * as api from "../lib/api";
import { historyToMessages } from "../lib/messages";

interface UseAgentReturn {
  messages: ChatMessage[];
  streaming: string;
  streamingTools: ChatMessage[];
  thinking: boolean;
  connected: boolean;
  status: StatusData | null;
  send: (text: string, attachments?: Attachment[]) => Promise<void>;
}

export function useAgent(agent: Agent | null, token: string | null): UseAgentReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState("");
  const [streamingTools, setStreamingTools] = useState<ChatMessage[]>([]);
  const [thinking, setThinking] = useState(false);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<StatusData | null>(null);
  const sseRef = useRef<api.SSEConnection | null>(null);
  const streamBufRef = useRef("");
  const toolsRef = useRef<ChatMessage[]>([]);

  const agentName = agent?.name || null;

  // Load history on agent change
  useEffect(() => {
    if (!agentName) return;
    let cancelled = false;

    async function load() {
      try {
        const [history, statusData] = await Promise.all([
          api.getHistory(agentName!, token),
          api.getStatus(agentName!, token),
        ]);
        if (cancelled) return;
        setMessages(historyToMessages(history));
        setStatus(statusData);
      } catch {
        if (!cancelled) setMessages([]);
      }
    }

    setMessages([]);
    setStreaming("");
    setStreamingTools([]);
    setThinking(false);
    load();
    return () => { cancelled = true; };
  }, [agentName, token]);

  // SSE connection
  useEffect(() => {
    if (!agentName) return;

    const sse = api.connectSSE(agentName, token, {
      onEvent(ev: StreamEvent) {
        switch (ev.type) {
          case "thinking":
            setThinking(true);
            break;

          case "text-delta":
            streamBufRef.current += ev.delta || "";
            setStreaming(streamBufRef.current);
            setThinking(false);
            break;

          case "tool-call": {
            setThinking(true);
            const tool: ChatMessage = {
              id: `stream-tool-${Date.now()}-${Math.random()}`,
              role: "tool",
              text: "",
              toolName: ev.toolName,
              toolInput: ev.toolInput,
              streaming: true,
            };
            toolsRef.current = [...toolsRef.current, tool];
            setStreamingTools([...toolsRef.current]);
            break;
          }

          case "tool-result":
            if (toolsRef.current.length > 0) {
              const updated = [...toolsRef.current];
              const last = { ...updated[updated.length - 1] };
              last.toolOutput = ev.output || ev.result;
              last.streaming = false;
              updated[updated.length - 1] = last;
              toolsRef.current = updated;
              setStreamingTools(updated);
            }
            setThinking(false);
            break;

          case "recall": {
            const recallTool: ChatMessage = {
              id: `stream-recall-${Date.now()}`,
              role: "tool",
              text: "",
              toolName: "recall",
              toolOutput: ev.text,
            };
            toolsRef.current = [...toolsRef.current, recallTool];
            setStreamingTools([...toolsRef.current]);
            break;
          }

          case "finish": {
            const tools = [...toolsRef.current];
            const text = streamBufRef.current;

            setMessages((prev) => {
              const next = [...prev, ...tools];
              if (text.trim()) {
                next.push({
                  id: `msg-${Date.now()}`,
                  role: "assistant",
                  text: text.trim(),
                });
              }
              return next;
            });

            streamBufRef.current = "";
            toolsRef.current = [];
            setStreaming("");
            setStreamingTools([]);
            setThinking(false);

            api.getStatus(agentName!, token).then(setStatus).catch(() => {});
            break;
          }

          case "error":
            setMessages((prev) => [
              ...prev,
              {
                id: `err-${Date.now()}`,
                role: "error",
                text: ev.error || "Unknown error",
              },
            ]);
            setThinking(false);
            setStreaming("");
            setStreamingTools([]);
            streamBufRef.current = "";
            toolsRef.current = [];
            break;
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
  }, [agentName, token]);

  const send = useCallback(
    async (text: string, attachments?: Attachment[]) => {
      if (!agentName) return;

      setMessages((prev) => [
        ...prev,
        {
          id: `msg-${Date.now()}`,
          role: "user",
          text,
          timestamp: new Date().toISOString(),
          iface: "web",
        },
      ]);

      setThinking(true);

      await api.sendMessage(agentName, token, text, {
        connectionId: sseRef.current?.connectionId,
        attachments,
      });
    },
    [agentName, token]
  );

  return { messages, streaming, streamingTools, thinking, connected, status, send };
}
