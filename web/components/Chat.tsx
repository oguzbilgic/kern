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
  alignLeft?: boolean;
  showTools?: boolean;
  coloredTools?: boolean;
  peekLastTool?: boolean;
}

export function Chat({ messages, streamParts, thinking, agentName, token, fullWidth, alignLeft, showTools = true, coloredTools = true, peekLastTool = true }: ChatProps) {
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

  // Peek last tool: only if it's the very last message (no text after it)
  const allMsgs = [...messages, ...streamParts];
  const lastMsg = allMsgs[allMsgs.length - 1];
  const lastToolId = peekLastTool && lastMsg?.role === "tool" ? lastMsg.id : undefined;

  // Determine effective sender role for grouping (tool counts as assistant)
  const senderRole = (msg: ChatMessage) =>
    msg.role === "tool" ? "assistant" : msg.role;

  const renderMsgs = (msgs: ChatMessage[]) => {
    let prevRole: string | null = null;
    return msgs.map((msg) => {
      // Hidden tools: skip entirely, don't affect grouping
      if (msg.role === "tool" && !showTools) return null;

      if (msg.role === "tool") {
        // Visible tool: doesn't affect prevRole for continuation
        return (
          <div key={msg.id} style={alignLeft ? { marginLeft: 42 } : undefined}>
            <ToolCall msg={msg} colored={coloredTools} peek={msg.id === lastToolId} />
          </div>
        );
      }

      const role = senderRole(msg);
      const continuation = alignLeft && role === prevRole;
      prevRole = role;

      return (
        <Message key={msg.id} msg={msg} agentName={agentName} token={token} fullWidth={fullWidth} alignLeft={alignLeft} continuation={continuation} />
      );
    });
  };

  return (
    <div className="flex-1 overflow-hidden relative">
      <div
        ref={containerRef}
        className="h-full overflow-y-auto px-4 py-4"
      >
        <div className="flex flex-col gap-2" style={{ maxWidth: fullWidth ? undefined : 800, margin: "0 auto" }}>
          {/* History messages */}
          {renderMsgs(messages)}

          {/* Streaming parts */}
          {renderMsgs(streamParts)}

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
