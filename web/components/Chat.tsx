"use client";

import { useEffect, useRef } from "react";
import type { ChatMessage } from "../lib/types";
import { renderMarkdown } from "../lib/markdown";
import { Message } from "./Message";
import { ToolCall } from "./ToolCall";
import { ThinkingDots } from "./ThinkingDots";

interface ChatProps {
  messages: ChatMessage[];
  streamParts: ChatMessage[];
  thinking: boolean;
}

export function Chat({ messages, streamParts, thinking }: ChatProps) {
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
  }, [messages, streamParts, thinking]);

  const isStreaming = streamParts.length > 0 || thinking;

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto px-4 py-4"
      style={{ maxWidth: 800, margin: "0 auto", width: "100%" }}
    >
      {/* History messages */}
      {messages.map((msg) =>
        msg.role === "tool" ? (
          <ToolCall key={msg.id} msg={msg} />
        ) : (
          <Message key={msg.id} msg={msg} />
        )
      )}

      {/* Streaming parts — rendered in order (interleaved text + tools) */}
      {streamParts.map((part) =>
        part.role === "tool" ? (
          <ToolCall key={part.id} msg={part} />
        ) : part.role === "assistant" && part.text ? (
          <div key={part.id} className="flex justify-start mb-2">
            <div className="max-w-[72%] text-sm leading-relaxed text-[var(--text)]">
              <div
                className="markdown-body"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(part.text) }}
              />
            </div>
          </div>
        ) : null
      )}

      {/* Thinking indicator */}
      {thinking && !streamParts.some((p) => p.role === "assistant" && p.text) && <ThinkingDots />}

      <div ref={bottomRef} />
    </div>
  );
}
