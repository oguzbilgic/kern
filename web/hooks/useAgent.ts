"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { Agent, ChatMessage, StreamEvent, Attachment, StatusData } from "../lib/types";
import * as api from "../lib/api";
import { historyToMessages, parseUserContent } from "../lib/messages";

interface UseAgentReturn {
  messages: ChatMessage[];
  streamParts: ChatMessage[];
  thinking: boolean;
  connected: boolean;
  status: StatusData | null;
  send: (text: string, attachments?: Attachment[]) => Promise<void>;
}

export function useAgent(agent: Agent | null, token: string | null): UseAgentReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamParts, setStreamParts] = useState<ChatMessage[]>([]);
  const [thinking, setThinking] = useState(false);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<StatusData | null>(null);
  const sseRef = useRef<api.SSEConnection | null>(null);
  const partsRef = useRef<ChatMessage[]>([]);

  const agentName = agent?.name || null;

  // Helper: get or create the last text part in the stream
  function getOrCreateTextPart(): ChatMessage {
    const parts = partsRef.current;
    const last = parts[parts.length - 1];
    if (last && last.role === "assistant") return last;
    // Create new text part
    const textPart: ChatMessage = {
      id: `stream-text-${Date.now()}-${Math.random()}`,
      role: "assistant",
      text: "",
    };
    parts.push(textPart);
    return textPart;
  }

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
    partsRef.current = [];
    setStreamParts([]);
    setThinking(false);
    load();

    // Poll status to detect busy state on refresh
    async function checkBusy() {
      try {
        const s = await api.getStatus(agentName!, token);
        if (!cancelled && s?.queue && typeof s.queue === "string" && s.queue.startsWith("busy")) {
          setThinking(true);
        }
      } catch {}
    }
    checkBusy();

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

          case "text-delta": {
            const textPart = getOrCreateTextPart();
            textPart.text += ev.text || ev.delta || "";
            setStreamParts([...partsRef.current]);
            setThinking(false);
            break;
          }

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
            partsRef.current.push(tool);
            setStreamParts([...partsRef.current]);
            break;
          }

          case "tool-result": {
            // Find last streaming tool
            const parts = partsRef.current;
            for (let i = parts.length - 1; i >= 0; i--) {
              if (parts[i].role === "tool" && parts[i].streaming) {
                parts[i] = { ...parts[i], toolOutput: ev.output || ev.result, streaming: false };
                break;
              }
            }
            setStreamParts([...partsRef.current]);
            setThinking(true); // Still busy — waiting for next step
            break;
          }

          case "recall": {
            const recallPart: ChatMessage = {
              id: `stream-recall-${Date.now()}`,
              role: "tool",
              text: "",
              toolName: "recall",
              toolOutput: ev.text,
            };
            partsRef.current.push(recallPart);
            setStreamParts([...partsRef.current]);
            break;
          }

          case "finish": {
            // Flush all stream parts into messages
            const flushed = partsRef.current.filter(
              (p) => p.role === "tool" || (p.role === "assistant" && p.text.trim())
            );

            if (flushed.length > 0) {
              setMessages((prev) => [...prev, ...flushed]);
            }

            partsRef.current = [];
            setStreamParts([]);
            setThinking(false);

            api.getStatus(agentName!, token).then(setStatus).catch(() => {});
            break;
          }

          case "incoming": {
            const parsed = parseUserContent(ev.text || "");
            if (parsed.type === "heartbeat") {
              setMessages((prev) => [...prev, {
                id: `hb-${Date.now()}`,
                role: "heartbeat",
                text: "♡ heartbeat",
                iface: "heartbeat",
              }]);
            } else {
              setMessages((prev) => [...prev, {
                id: `in-${Date.now()}`,
                role: "incoming",
                text: parsed.text || ev.text || "",
                meta: `[${ev.fromInterface || "?"} ${ev.fromUserId || ""}]`.trim(),
                iface: ev.fromInterface,
              }]);
            }
            break;
          }

          case "outgoing":
            setMessages((prev) => [...prev, {
              id: `out-${Date.now()}`,
              role: "assistant",
              text: ev.text || "",
              meta: `→ ${ev.fromInterface || "?"}`,
              iface: ev.fromInterface,
            }]);
            break;

          case "heartbeat":
            setMessages((prev) => [...prev, {
              id: `hb-${Date.now()}`,
              role: "heartbeat",
              text: "♡ heartbeat",
              iface: "heartbeat",
            }]);
            break;

          case "command-result":
            setMessages((prev) => [...prev, {
              id: `cmd-${Date.now()}`,
              role: "assistant",
              text: ev.text || "",
              meta: `/${ev.command}`,
            }]);
            break;

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
            partsRef.current = [];
            setStreamParts([]);
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

  return { messages, streamParts, thinking, connected, status, send };
}
