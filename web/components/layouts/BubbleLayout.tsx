"use client";

import type { ChatMessage } from "../../lib/types";
import type { MessageGroupInfo } from "../../lib/messages";
import { analyzeMessage, formatTime } from "../../lib/messages";
import { SpecialMessage, MediaAttachments, MessageBody } from "../MessageContent";
import { ToolCall } from "../ToolCall";
import { RenderBlock } from "../RenderBlock";
import { ScrollToBottom } from "../ScrollToBottom";
import { useChat } from "../../hooks/useChat";

interface BubbleLayoutProps {
  messages: ChatMessage[];
  streamParts: ChatMessage[];
  thinking: boolean;
  agentName?: string;
  token?: string;
  serverUrl?: string;
  showTools: boolean;
  coloredTools: boolean;
  peekLastTool: boolean;
  loadMore?: () => Promise<void>;
  hasMore?: boolean;
  loadingMore?: boolean;
}

export function BubbleLayout({ messages, streamParts, thinking, agentName, token, serverUrl, showTools, coloredTools, peekLastTool, loadMore, hasMore, loadingMore }: BubbleLayoutProps) {
  const { containerRef, bottomRef, showScrollBtn, scrollToBottom, allMsgs, lastToolId, groups, showDots, loadingMore: isLoadingMore } = useChat({
    messages, streamParts, thinking, showTools, peekLastTool, loadMore, hasMore, loadingMore,
  });

  const renderMsg = (msg: ChatMessage) => {
    if (msg.role === "tool" && !showTools) return null;

    if (msg.role === "tool") {
      return (
        <div key={msg.id}>
          <ToolCall msg={msg} colored={coloredTools} peek={msg.id === lastToolId} />
        </div>
      );
    }

    if (msg.role === "render") {
      return (
        <div key={msg.id} className="flex justify-start">
          <RenderBlock msg={msg} />
        </div>
      );
    }

    const props = analyzeMessage(msg, agentName);
    if (props.isHeartbeat || props.isError || props.isCommand || props.isNoReply || props.isEmoji) {
      return <div key={msg.id}><SpecialMessage props={props} agentName={agentName} token={token} /></div>;
    }

    const { isUser, isIncoming } = props;

    return (
      <div key={msg.id} className={`flex ${isUser || isIncoming ? "justify-end" : "justify-start"}`}>
        <div className="flex flex-col max-w-[72%]">
          {isIncoming && msg.meta && (
            <div className="text-[10px] text-[var(--text-muted)] mb-0.5 text-right">{msg.meta}</div>
          )}

          {msg.media && msg.media.length > 0 && (
            <MediaAttachments media={msg.media} agentName={agentName} token={token} serverUrl={serverUrl} />
          )}

          {(msg.text || !msg.media?.length) && (
            <div className={`rounded-lg px-3 py-2 text-sm leading-relaxed ${
              isUser ? "bg-[var(--bg-surface)] text-[#d4d4d4] rounded-br-sm"
                : isIncoming ? "bg-[var(--bg-surface)] rounded-bl-sm"
                  : "bg-[var(--bg-surface)] text-[var(--text)] rounded-bl-sm"
            }`}>
              <MessageBody msg={msg} />
            </div>
          )}

          {msg.timestamp && (
            <div className={`text-[10px] text-[var(--text-muted)] mt-0.5 ${isUser || isIncoming ? "text-right" : "text-left"}`}>
              {formatTime(msg.timestamp)}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 overflow-hidden relative">
      <div ref={containerRef} className="h-full overflow-y-auto px-4 pt-4 pb-1">
        <div className="flex flex-col gap-2" style={{ maxWidth: 800, margin: "0 auto", paddingLeft: 16, paddingRight: 16 }}>
          {isLoadingMore && (
            <div className="text-center py-2 text-xs" style={{ color: "var(--text-dim)" }}>Loading…</div>
          )}
          {allMsgs.map(renderMsg)}
          <div ref={bottomRef} />
        </div>
      </div>
      {showScrollBtn && <ScrollToBottom onClick={scrollToBottom} />}
    </div>
  );
}
