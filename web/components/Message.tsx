"use client";

import type { ChatMessage } from "../lib/types";
import { renderMarkdown } from "../lib/markdown";
import { isEmojiOnly, formatTime } from "../lib/messages";
import { ToolCall } from "./ToolCall";

export function Message({ msg }: { msg: ChatMessage }) {
  if (msg.role === "tool") {
    return <ToolCall msg={msg} />;
  }

  if (msg.role === "heartbeat") {
    return (
      <div className="flex justify-end mb-2">
        <div className="text-xs text-[var(--text-muted)] italic px-3 py-1">
          ♡ heartbeat
        </div>
      </div>
    );
  }

  if (msg.role === "error") {
    return (
      <div className="flex justify-start mb-2">
        <div className="rounded-lg px-3 py-2 text-sm bg-red-900/30 text-[var(--red)] max-w-[80%]">
          {msg.text}
        </div>
      </div>
    );
  }

  const isUser = msg.role === "user";
  const isIncoming = msg.role === "incoming";
  const emoji = isUser && isEmojiOnly(msg.text);
  const noReply = msg.role === "assistant" && (msg.text === "NO_REPLY" || msg.text === "(no text response)");

  if (noReply) {
    return (
      <div className="flex justify-start mb-2">
        <div className="text-xs text-[var(--text-muted)] italic px-3 py-1">
          {msg.text}
        </div>
      </div>
    );
  }

  return (
    <div className={`flex ${isUser || isIncoming ? "justify-end" : "justify-start"} mb-2`}>
      <div className="flex flex-col max-w-[72%]">
        {/* Meta label for incoming messages */}
        {isIncoming && msg.meta && (
          <div className="text-[10px] text-[var(--text-muted)] mb-0.5 text-right">
            {msg.meta}
          </div>
        )}

        {/* Message bubble */}
        <div
          className={`rounded-lg px-3 py-2 text-sm leading-relaxed ${
            emoji
              ? "text-4xl bg-transparent"
              : isUser
                ? "bg-[var(--user-bg)] text-white rounded-br-sm"
                : isIncoming
                  ? "bg-[var(--bg-surface)] rounded-bl-sm"
                  : "text-[var(--text)]"
          }`}
        >
          {msg.role === "assistant" ? (
            <div
              className="markdown-body"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.text) }}
            />
          ) : (
            <span className="whitespace-pre-wrap">{msg.text}</span>
          )}
        </div>

        {/* Timestamp */}
        {msg.timestamp && (
          <div
            className={`text-[10px] text-[var(--text-muted)] mt-0.5 ${
              isUser || isIncoming ? "text-right" : "text-left"
            }`}
          >
            {formatTime(msg.timestamp)}
          </div>
        )}
      </div>
    </div>
  );
}
