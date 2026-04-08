"use client";

import type { ChatMessage } from "../../lib/types";
import { analyzeMessage, formatTime } from "../../lib/messages";
import { avatarColor } from "../../lib/colors";
import { SpecialMessage, MediaAttachments, MessageBody } from "../MessageContent";
import { ToolCall } from "../ToolCall";
import { ThinkingDots } from "../ThinkingDots";
import { ScrollToBottom } from "../ScrollToBottom";
import { useChat } from "../../hooks/useChat";

interface SlackLayoutProps {
  messages: ChatMessage[];
  streamParts: ChatMessage[];
  thinking: boolean;
  agentName?: string;
  token?: string;
  showTools: boolean;
  coloredTools: boolean;
  peekLastTool: boolean;
}

function Avatar({ name, isUser }: { name: string; isUser: boolean }) {
  const bgColor = isUser ? "#3a3a3a" : avatarColor(name);
  return (
    <div className="w-8 h-8 rounded-md flex items-center justify-center text-xs font-semibold flex-shrink-0 mt-0.5"
      style={{ backgroundColor: bgColor, color: isUser ? "var(--text-dim)" : "#fff" }}>
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

export function SlackLayout({ messages, streamParts, thinking, agentName, token, showTools, coloredTools, peekLastTool }: SlackLayoutProps) {
  const { containerRef, bottomRef, showScrollBtn, scrollToBottom, allMsgs, lastToolId, groups, showDots } = useChat({
    messages, streamParts, thinking, showTools, peekLastTool,
  });

  const renderMsg = (msg: ChatMessage) => {
    if (msg.role === "tool" && !showTools) return null;

    const group = groups.get(msg.id);

    if (msg.role === "tool") {
      return (
        <div key={msg.id}>
          {group?.needsAgentHeader && (
            <div className="flex items-start gap-2.5">
              <Avatar name={agentName || "Agent"} isUser={false} />
              <span className="text-sm font-semibold text-[var(--text)]">{agentName || "Agent"}</span>
            </div>
          )}
          <div style={{ marginLeft: 42 }}>
            <ToolCall msg={msg} colored={coloredTools} peek={msg.id === lastToolId} />
          </div>
        </div>
      );
    }

    const props = analyzeMessage(msg, agentName);
    if (props.isHeartbeat || props.isError || props.isCommand || props.isNoReply || props.isEmoji) {
      return <div key={msg.id}><SpecialMessage props={props} agentName={agentName} token={token} /></div>;
    }

    const { isUser, senderName } = props;
    const continuation = group?.continuation ?? false;

    return (
      <div key={msg.id} className="flex items-start gap-2.5">
        {continuation ? (
          <div className="w-8 flex-shrink-0" />
        ) : (
          <Avatar name={senderName} isUser={isUser} />
        )}
        <div className="flex flex-col min-w-0 max-w-[95%]">
          {!continuation && (
            <div className="flex items-baseline gap-2">
              <span className="text-sm font-semibold text-[var(--text)]">{senderName}</span>
              {msg.timestamp && (
                <span className="text-[10px] text-[var(--text-muted)]">{formatTime(msg.timestamp)}</span>
              )}
            </div>
          )}

          {msg.media && msg.media.length > 0 && (
            <MediaAttachments media={msg.media} agentName={agentName} token={token} />
          )}

          {(msg.text || !msg.media?.length) && (
            <div className="text-sm leading-relaxed text-[#c8c8c8]">
              <MessageBody msg={msg} />
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 overflow-hidden relative">
      <div ref={containerRef} className="h-full overflow-y-auto px-4 py-4">
        <div className="flex flex-col gap-2">
          {allMsgs.map(renderMsg)}
          {showDots && <ThinkingDots />}
          <div ref={bottomRef} />
        </div>
      </div>
      {showScrollBtn && <ScrollToBottom onClick={scrollToBottom} />}
    </div>
  );
}
