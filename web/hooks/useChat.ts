"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../lib/types";
import { computeGroups, type MessageGroupInfo } from "../lib/messages";

interface UseChatOptions {
  messages: ChatMessage[];
  streamParts: ChatMessage[];
  thinking: boolean;
  showTools: boolean;
  peekLastTool: boolean;
}

export function useChat({ messages, streamParts, thinking, showTools, peekLastTool }: UseChatOptions) {
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
    (el as any)._setProgrammatic = (v: boolean) => { programmaticScroll = v; };
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Auto-scroll on new content
  useEffect(() => {
    if (userScrolledUp.current) return;
    const el = containerRef.current;
    if (!el) return;
    const setter = (el as any)._setProgrammatic;
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

  // All messages combined
  const allMsgs = [...messages, ...streamParts];

  // Peek last tool: only if it's the very last message
  const lastMsg = allMsgs[allMsgs.length - 1];
  const lastToolId = peekLastTool && lastMsg?.role === "tool" ? lastMsg.id : undefined;

  // Grouping info for continuation/headers
  const groups = computeGroups(allMsgs, showTools);

  return {
    containerRef,
    bottomRef,
    showScrollBtn,
    scrollToBottom,
    allMsgs,
    lastToolId,
    groups,
    showDots: thinking,
  };
}
