"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage } from "../lib/types";
import { renderMarkdown } from "../lib/markdown";
import { Message } from "./Message";
import { ToolCall } from "./ToolCall";
import { ThinkingDots } from "./ThinkingDots";

interface ChatProps {
  messages: ChatMessage[];
  streaming: string;
  thinking: boolean;
  streamingTools: ChatMessage[];
}

export function Chat({ messages, streaming, thinking, streamingTools }: ChatProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const userScrolledUp = useRef(false);

  // Track user scroll
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let programmaticScroll = false;

    function onScroll() {
      if (programmaticScroll) return;
      const atBottom = el!.scrollHeight - el!.scrollTop - el!.clientHeight < 40;
      userScrolledUp.current = !atBottom;
    }

    el.addEventListener("scroll", onScroll);

    // Expose for scrollToBottom
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
      requestAnimationFrame(() => setter?.(false));
    });
  }, [messages, streaming, thinking]);

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto px-4 py-4"
      style={{ maxWidth: 800, margin: "0 auto", width: "100%" }}
    >
      {/* History messages */}
      {messages.map((msg) => (
        <Message key={msg.id} msg={msg} />
      ))}

      {/* Streaming tool calls */}
      {streamingTools.map((tool) => (
        <ToolCall key={tool.id} msg={tool} />
      ))}

      {/* Streaming text */}
      {streaming && (
        <div className="flex justify-start mb-2">
          <div className="max-w-[72%] text-sm leading-relaxed text-[var(--text)]">
            <div
              className="markdown-body"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(streaming) }}
            />
          </div>
        </div>
      )}

      {/* Thinking indicator */}
      {thinking && !streaming && <ThinkingDots />}

      <div ref={bottomRef} />
    </div>
  );
}
