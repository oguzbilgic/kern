"use client";

import { useState, useEffect } from "react";
import * as api from "../../lib/api";
import { renderMarkdown } from "../../lib/markdown";
import { TabProps, accent, StatCard, ActionBtn } from "./shared";

// ─── Parsing ────────────────────────────────────────────
interface PromptSectionData {
  tag: string;
  attrs: Record<string, string>;
  content: string;
}

function parsePromptSections(prompt: string): PromptSectionData[] {
  const sections: PromptSectionData[] = [];
  const regex = /<(\w+)([^>]*)>([\s\S]*?)<\/\1>/g;
  let match;
  let lastIndex = 0;

  while ((match = regex.exec(prompt)) !== null) {
    if (match.index > lastIndex) {
      const before = prompt.slice(lastIndex, match.index).trim();
      if (before) sections.push({ tag: "text", attrs: {}, content: before });
    }
    const attrs: Record<string, string> = {};
    const attrRegex = /(\w+)="([^"]*)"/g;
    let am;
    while ((am = attrRegex.exec(match[2])) !== null) {
      attrs[am[1]] = am[2];
    }
    sections.push({ tag: match[1], attrs, content: match[3].trim() });
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < prompt.length) {
    const trailing = prompt.slice(lastIndex).trim();
    if (trailing) sections.push({ tag: "text", attrs: {}, content: trailing });
  }
  return sections;
}

// ─── Context Tab ────────────────────────────────────────
export function ContextTab({ agentName, token, serverUrl }: TabProps) {
  const [prompt, setPrompt] = useState<string | null>(null);
  const [status, setStatus] = useState<any>(null);
  const [view, setView] = useState<"structured" | "raw">("structured");

  useEffect(() => {
    api.getSystemPrompt(agentName, token, serverUrl).then(setPrompt).catch(() => {});
    api.getStatus(agentName, token, serverUrl).then(setStatus).catch(() => {});
  }, [agentName, token, serverUrl]);

  if (prompt === null) return <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading...</div>;

  const cb = status?.contextBreakdown;
  const systemTokens = cb?.systemPromptTokens || 0;
  const summaryTokens = cb?.summaryTokens || 0;
  const messageTokens = cb?.messageTokens || 0;
  const totalTokens = systemTokens + summaryTokens + messageTokens || Math.round(prompt.length / 3.3);
  const maxTokens = cb?.maxTokens || 0;

  return (
    <div>
      {/* Stats row */}
      {cb && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginBottom: 16 }}>
          <StatCard label="System Prompt" value={`${(systemTokens / 1000).toFixed(1)}k`} />
          <StatCard label="Summaries" value={`${(summaryTokens / 1000).toFixed(1)}k`} />
          <StatCard label="Messages" value={`${cb.messageCount ?? 0} (${(messageTokens / 1000).toFixed(1)}k)`} />
          <StatCard label="Total / Budget" value={`${(totalTokens / 1000).toFixed(0)}k / ${(maxTokens / 1000).toFixed(0)}k`} />
        </div>
      )}

      {/* Toggle */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
          {cb ? `${cb.totalMessages?.toLocaleString()} total messages · ${cb.trimmedCount?.toLocaleString()} trimmed · ${cb.truncatedCount || 0} truncated` : `~${totalTokens.toLocaleString()} tokens`}
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          <ActionBtn active={view === "structured"} onClick={() => setView("structured")}>Structured</ActionBtn>
          <ActionBtn active={view === "raw"} onClick={() => setView("raw")}>Raw</ActionBtn>
        </div>
      </div>

      {view === "raw" ? (
        <pre style={{
          color: "var(--text)",
          fontSize: 13,
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          padding: 18,
          overflow: "auto",
          maxHeight: "60vh",
          fontFamily: "var(--font-mono)",
        }}>
          {prompt}
        </pre>
      ) : (
        <StructuredPrompt prompt={prompt} totalTokens={totalTokens} systemTokens={systemTokens} summaryTokens={summaryTokens} messageTokens={messageTokens} />
      )}
    </div>
  );
}

// ─── Structured View ────────────────────────────────────
function StructuredPrompt({ prompt, totalTokens, systemTokens, summaryTokens, messageTokens }: {
  prompt: string; totalTokens: number; systemTokens?: number; summaryTokens?: number; messageTokens?: number;
}) {
  const sections = parsePromptSections(prompt);
  const [openSections, setOpenSections] = useState<Set<number>>(new Set());

  const toggle = (i: number) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  };

  const typeColor: Record<string, string> = {
    document: accent,
    notes_summary: "#8b5cf6",
    tools: "#f59e0b",
    conversation_summary: "#10b981",
    summary: "#10b981",
    text: "#6b7280",
  };

  return (
    <div>
      {/* Token bar */}
      <div style={{ display: "flex", height: 24, borderRadius: 6, overflow: "hidden", marginBottom: 16, gap: 2 }}>
        {sections.map((s, i) => {
          const tokens = Math.round(s.content.length / 3.3);
          const pct = Math.max(1, (tokens / totalTokens) * 100);
          const color = typeColor[s.tag] || "#6b7280";
          return (
            <div
              key={i}
              style={{
                width: `${pct}%`,
                minWidth: 2,
                height: "100%",
                background: color,
                opacity: 0.6,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 9,
                fontFamily: "var(--font-mono)",
                color: "rgba(255,255,255,0.85)",
                overflow: "hidden",
                whiteSpace: "nowrap",
                cursor: "pointer",
              }}
              title={`${s.attrs.path || s.tag}: ~${tokens} tokens`}
              onClick={() => toggle(i)}
            >
              {pct > 5 ? (s.attrs.path || s.tag) : ""}
            </div>
          );
        })}
        {/* Raw messages bar segment */}
        {messageTokens && messageTokens > 0 && (
          <div
            style={{
              width: `${Math.max(1, (messageTokens / totalTokens) * 100)}%`,
              minWidth: 2,
              height: "100%",
              background: "#3b82f6",
              opacity: 0.6,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 9,
              fontFamily: "var(--font-mono)",
              color: "rgba(255,255,255,0.85)",
              overflow: "hidden",
              whiteSpace: "nowrap",
            }}
            title={`Raw messages: ~${messageTokens} tokens`}
          >
            {(messageTokens / totalTokens) * 100 > 5 ? "messages" : ""}
          </div>
        )}
      </div>

      {/* Sections */}
      {sections.map((s, i) => {
        const isOpen = openSections.has(i);
        const color = typeColor[s.tag] || "#6b7280";
        const tokens = Math.round(s.content.length / 3.3);

        return (
          <div key={i} style={{
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            marginBottom: 10,
            overflow: "hidden",
          }}>
            <div
              onClick={() => toggle(i)}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "10px 14px",
                cursor: "pointer",
                borderLeft: `3px solid ${color}`,
                gap: 12,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{
                  fontSize: 11,
                  color: "var(--text-muted)",
                  transition: "transform 0.15s",
                  display: "inline-block",
                  transform: isOpen ? "rotate(90deg)" : "none",
                }}>
                  ▶
                </span>
                <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>
                  {s.attrs.path || s.tag}
                </span>
              </div>
              <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                ~{tokens > 1000 ? `${(tokens / 1000).toFixed(1)}k` : tokens} tokens
              </span>
            </div>
            {isOpen && (
              <div style={{ padding: "0 14px 14px", borderTop: "1px solid var(--border)" }}>
                <div
                  className="markdown-body"
                  style={{ color: "var(--text)", fontSize: 13, lineHeight: 1.6, paddingTop: 12 }}
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(s.content) }}
                />
              </div>
            )}
          </div>
        );
      })}

      {/* Raw Messages section */}
      {messageTokens && messageTokens > 0 && (
        <div style={{
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 10,
          marginBottom: 10,
          overflow: "hidden",
        }}>
          <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "10px 14px",
            borderLeft: "3px solid #3b82f6",
            gap: 12,
          }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>
              Raw Messages
            </span>
            <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-muted)", whiteSpace: "nowrap" }}>
              ~{messageTokens > 1000 ? `${(messageTokens / 1000).toFixed(1)}k` : messageTokens} tokens
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
