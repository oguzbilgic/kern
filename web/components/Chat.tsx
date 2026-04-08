"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../lib/types";
import { Message } from "./Message";
import { ToolCall } from "./ToolCall";
import { ThinkingDots } from "./ThinkingDots";

interface ChatProps {
  messages: ChatMessage[];
  streamParts: ChatMessage[];
  thinking: boolean;
  agentName?: string;
  token?: string;
  fullWidth?: boolean;
  coloredTools?: boolean;
  peekLastTool?: boolean;
}

export function Chat({ messages, streamParts, thinking, agentName, token, fullWidth, coloredTools = true, peekLastTool = true }: ChatProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const userScrolledUp = useRef(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  // Track user scroll
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let programmaticScroll = false;

    function onScroll() {
      if (programmaticScroll) return;
      const atBottom = el!.scrollHeight - el!.scrollTop - el!.clientHeight < 40;
      userScrolledUp.current = !atBottom;
      setShowScrollBtn(!atBottom);
    }

    el.addEventListener("scroll", onScroll);

    (el as unknown as { _setProgrammatic: (v: boolean) => void })._setProgrammatic = (v: boolean) => {
      programmaticScroll = v;
    };

    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Auto-scroll on new content
  useEffect(() => {
    if (userScrolledUp.current) return;
    const el = containerRef.current;
    if (!el) return;
    const setter = (el as unknown as { _setProgrammatic?: (v: boolean) => void })._setProgrammatic;
    setter?.(true);
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: "instant" });
      requestAnimationFrame(() => {
        setter?.(false);
        setShowScrollBtn(false);
      });
    });
  }, [messages, streamParts, thinking]);

  const scrollToBottom = () => {
    userScrolledUp.current = false;
    setShowScrollBtn(false);
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const showDots = thinking;

  // Find last tool call ID for peek feature
  const allMsgs = [...messages, ...streamParts];
  const lastToolId = peekLastTool
    ? [...allMsgs].reverse().find((m) => m.role === "tool")?.id
    : undefined;

  const renderMsg = (msg: ChatMessage) =>
    msg.role === "tool" ? (
      <ToolCall key={msg.id} msg={msg} colored={coloredTools} peek={msg.id === lastToolId} />
    ) : (
      <Message key={msg.id} msg={msg} agentName={agentName} token={token} />
    );

  return (
    <div className="flex-1 overflow-hidden relative">
      <div
        ref={containerRef}
        className="h-full overflow-y-auto px-4 py-4"
      >
        <div style={{ maxWidth: fullWidth ? undefined : 800, margin: "0 auto" }}>
          {/* History messages */}
          {messages.map(renderMsg)}

          {/* Streaming parts */}
          {streamParts.map(renderMsg)}

          {/* Thinking indicator */}
          {showDots && <ThinkingDots />}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Scroll-to-bottom button — positioned relative to chat container */}
      {showScrollBtn && (
        <button
          onClick={scrollToBottom}
          style={{
            position: "absolute",
            bottom: 12,
            left: "50%",
            transform: "translateX(-50%)",
            width: 40,
            height: 40,
            borderRadius: "50%",
            background: "var(--bg-secondary, var(--bg-surface))",
            border: "1px solid var(--border)",
            color: "var(--text)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            fontSize: 20,
            boxShadow: "0 2px 12px rgba(0,0,0,0.4)",
            opacity: 0.85,
            zIndex: 10,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.85"; }}
          title="Scroll to bottom"
        >
          ↓
        </button>
      )}
    </div>
  );
}
