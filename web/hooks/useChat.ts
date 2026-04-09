"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../lib/types";
import { computeGroups } from "../lib/messages";

interface UseChatOptions {
  agentName?: string;
  messages: ChatMessage[];
  streamParts: ChatMessage[];
  thinking: boolean;
  showTools: boolean;
  peekLastTool: boolean;
  loadMore?: () => Promise<void>;
  hasMore?: boolean;
  loadingMore?: boolean;
}

export function useChat({ agentName, messages, streamParts, thinking, showTools, peekLastTool, loadMore, hasMore, loadingMore }: UseChatOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);

  // Track whether user has scrolled away from bottom (in column-reverse, "top" is away from latest)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    function onScroll() {
      // In column-reverse, scrollTop 0 = bottom (latest messages). Negative or > 0 = scrolled up.
      const atBottom = el!.scrollTop >= -40;
      setShowScrollBtn(!atBottom);

      // Infinite scroll: when user scrolls to visual top (which is scrollTop near negative max)
      const maxScroll = el!.scrollHeight - el!.clientHeight;
      const scrolledUp = -el!.scrollTop;
      if (scrolledUp > maxScroll - 200 && hasMore && !loadingMore && loadMore) {
        loadMore();
      }
    }
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [hasMore, loadingMore, loadMore]);

  const scrollToBottom = () => {
    const el = containerRef.current;
    if (el) {
      el.scrollTo({ top: 0, behavior: "smooth" });
      setShowScrollBtn(false);
    }
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
    showScrollBtn,
    scrollToBottom,
    allMsgs,
    lastToolId,
    groups,
    showDots: thinking,
    loadingMore: loadingMore ?? false,
  };
}
