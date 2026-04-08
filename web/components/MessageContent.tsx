"use client";

import type { ChatMessage, MediaItem } from "../lib/types";
import type { MessageProps } from "../lib/messages";
import { renderMarkdown } from "../lib/markdown";
import { formatTime } from "../lib/messages";

export function MediaAttachments({ media, agentName, token }: { media: MediaItem[]; agentName?: string; token?: string }) {
  if (!media.length) return null;
  const qs = token ? `?token=${token}` : "";
  const resolveUrl = (url: string) =>
    url.startsWith("data:") ? url : `/api/agents/${agentName}/media/${url}${qs}`;
  return (
    <div className="flex flex-wrap gap-2 mt-1">
      {media.map((m, i) =>
        m.type === "image" ? (
          <img key={i} src={resolveUrl(m.url)} alt={m.filename || "image"}
            className="rounded-lg max-w-[280px] max-h-[280px] object-cover border border-[var(--border)]" loading="lazy" />
        ) : (
          <a key={i} href={resolveUrl(m.url)} target="_blank" rel="noopener"
            className="flex items-center gap-1.5 text-xs text-[var(--accent)] bg-[var(--bg-surface)] rounded-lg px-3 py-2 border border-[var(--border)] hover:opacity-80">
            📎 {m.filename || m.url}
          </a>
        )
      )}
    </div>
  );
}

// Renders the text body of a message — markdown for assistant, plain for others
export function MessageBody({ msg }: { msg: ChatMessage }) {
  if (msg.role === "assistant") {
    return (
      <div className="markdown-body"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.text) }} />
    );
  }
  return <span className="whitespace-pre-wrap">{msg.text}</span>;
}

// Renders special message types: heartbeat, error, command, NO_REPLY, emoji
// Returns null if message is a normal text message
export function SpecialMessage({ props, agentName, token }: { props: MessageProps; agentName?: string; token?: string }) {
  const { msg, isHeartbeat, isError, isCommand, isNoReply, isEmoji, isUser, isIncoming } = props;

  if (isHeartbeat) {
    return (
      <div className="flex justify-end">
        <div className="text-xs text-[var(--text-muted)] italic px-3 py-1">♡ heartbeat</div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex justify-start">
        <div className="rounded-lg px-3 py-2 text-sm bg-red-900/30 text-[var(--red)] max-w-[80%]">
          {msg.text}
        </div>
      </div>
    );
  }

  if (isCommand) {
    return (
      <div className="flex justify-start">
        <div className="flex flex-col max-w-[90%]">
          {msg.meta && <div className="text-[10px] text-[var(--text-muted)] mb-0.5">{msg.meta}</div>}
          <div className="text-xs font-mono text-[var(--text-dim)] whitespace-pre-wrap px-3 py-2 border-l-[3px] border-[var(--green)]"
            style={{ background: "var(--bg-surface)" }}>
            {msg.text}
          </div>
        </div>
      </div>
    );
  }

  if (isNoReply) {
    return (
      <div className="flex justify-start">
        <div className="text-xs text-[var(--text-muted)] italic px-3 py-1 opacity-50">
          {msg.text || "(no text response)"}
        </div>
      </div>
    );
  }

  if (isEmoji) {
    return (
      <div className={`flex ${isUser || isIncoming ? "justify-end" : "justify-start"}`}>
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

  return null;
}
