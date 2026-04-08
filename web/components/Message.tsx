"use client";

import type { ChatMessage, MediaItem } from "../lib/types";
import { renderMarkdown } from "../lib/markdown";
import { isEmojiOnly, formatTime } from "../lib/messages";
import { ToolCall } from "./ToolCall";

function MediaAttachments({ media, agentName, token }: { media: MediaItem[]; agentName?: string; token?: string }) {
  if (!media.length) return null;
  const qs = token ? `?token=${token}` : "";
  const resolveUrl = (url: string) =>
    url.startsWith("data:") ? url : `/api/agents/${agentName}/media/${url}${qs}`;
  return (
    <div className="flex flex-wrap gap-2 mt-1">
      {media.map((m, i) =>
        m.type === "image" ? (
          <img
            key={i}
            src={resolveUrl(m.url)}
            alt={m.filename || "image"}
            className="rounded-lg max-w-[280px] max-h-[280px] object-cover border border-[var(--border)]"
            loading="lazy"
          />
        ) : (
          <a
            key={i}
            href={resolveUrl(m.url)}
            target="_blank"
            rel="noopener"
            className="flex items-center gap-1.5 text-xs text-[var(--accent)] bg-[var(--bg-surface)] rounded-lg px-3 py-2 border border-[var(--border)] hover:opacity-80"
          >
            📎 {m.filename || m.url}
          </a>
        )
      )}
    </div>
  );
}

export function Message({ msg, agentName, token }: { msg: ChatMessage; agentName?: string; token?: string }) {
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

  if (msg.role === "command") {
    return (
      <div className="flex justify-start mb-2">
        <div className="flex flex-col max-w-[90%]">
          {msg.meta && (
            <div className="text-[10px] text-[var(--text-muted)] mb-0.5">{msg.meta}</div>
          )}
          <div
            className="text-xs font-mono text-[var(--text-dim)] whitespace-pre-wrap px-3 py-2 border-l-[3px] border-[var(--green)]"
            style={{ background: "var(--bg-surface)" }}
          >
            {msg.text}
          </div>
        </div>
      </div>
    );
  }

  const isUser = msg.role === "user";
  const isIncoming = msg.role === "incoming";
  const emoji = isUser && isEmojiOnly(msg.text);
  const noReply = msg.role === "assistant" && (
    msg.text === "NO_REPLY" ||
    msg.text === "(no text response)" ||
    !msg.text?.trim()
  );

  // Dim NO_REPLY / empty assistant messages
  if (noReply) {
    return (
      <div className="flex justify-start mb-2">
        <div className="text-xs text-[var(--text-muted)] italic px-3 py-1 opacity-50">
          {msg.text || "(no text response)"}
        </div>
      </div>
    );
  }

  // Emoji-only messages — large font, no bubble
  if (emoji) {
    return (
      <div className={`flex ${isUser || isIncoming ? "justify-end" : "justify-start"} mb-2`}>
        <div className="flex flex-col">
          <span className="text-4xl leading-tight">{msg.text}</span>
          {msg.timestamp && (
            <div className={`text-[10px] text-[var(--text-muted)] mt-0.5 ${isUser || isIncoming ? "text-right" : "text-left"}`}>
              {formatTime(msg.timestamp)}
            </div>
          )}
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

        {/* Media attachments */}
        {msg.media && msg.media.length > 0 && (
          <MediaAttachments media={msg.media} agentName={agentName} token={token} />
        )}

        {/* Message bubble */}
        {(msg.text || !msg.media?.length) && (
          <div
            className={`rounded-lg px-3 py-2 text-sm leading-relaxed ${
              isUser
                ? "bg-[var(--bg-surface)] text-[#d4d4d4] rounded-br-sm"
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
        )}

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
