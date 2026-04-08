"use client";

import { useState } from "react";
import type { ChatMessage } from "../lib/types";

const TOOL_COLORS: Record<string, string> = {
  bash: "#e5c07b",
  read: "#e6edf3",
  write: "#e6edf3",
  edit: "#f97583",
  glob: "#e6edf3",
  grep: "#e6edf3",
  webfetch: "#e6edf3",
  websearch: "#e6edf3",
  pdf: "#e6edf3",
  image: "#e6edf3",
  kern: "#e6edf3",
  recall: "#e6edf3",
  message: "#56d364",
};

function toolSummary(msg: ChatMessage): string {
  const input = msg.toolInput || {};
  const name = msg.toolName || "tool";

  switch (name) {
    case "bash":
      return `$ ${(input.command as string || "").slice(0, 80)}`;
    case "read":
      return `${input.path || ""}`;
    case "write":
      return `${input.path || ""}`;
    case "edit":
      return `${input.path || ""}`;
    case "glob":
      return `${input.pattern || ""}`;
    case "grep":
      return `/${input.pattern || ""}/ ${input.path || ""}`;
    case "webfetch":
      return `${input.url || ""}`;
    case "websearch":
      return `"${input.query || ""}"`;
    case "message":
      return `→ ${input.userId || ""} via ${input.interface || ""}`;
    default:
      return name;
  }
}

export function ToolCall({ msg }: { msg: ChatMessage }) {
  const [expanded, setExpanded] = useState(false);
  const color = TOOL_COLORS[msg.toolName || ""] || "#e6edf3";

  return (
    <div className="mb-1">
      {/* Tool header — clickable */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs font-mono w-full text-left hover:opacity-80 py-0.5"
        style={{ color }}
      >
        <span className="opacity-50">{expanded ? "▼" : "▶"}</span>
        <span className="font-semibold">{msg.toolName}</span>
        <span className="opacity-70 truncate">{toolSummary(msg)}</span>
        {msg.streaming && (
          <span className="animate-pulse ml-1 opacity-60">⋯</span>
        )}
      </button>

      {/* Expanded output */}
      {expanded && msg.toolOutput && (
        <div className="mt-1 ml-4 max-h-[400px] overflow-auto rounded bg-[#161616] border border-[var(--border)] p-2">
          <pre className="text-xs font-mono text-[var(--text-dim)] whitespace-pre-wrap break-words">
            {msg.toolOutput}
          </pre>
        </div>
      )}
    </div>
  );
}
