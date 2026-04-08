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
  children?: PromptSectionData[];
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
    const content = match[3].trim();
    const section: PromptSectionData = { tag: match[1], attrs, content };

    // Parse nested <summary> blocks inside conversation_summary
    if (match[1] === "conversation_summary" || match[1] === "notes_summary") {
      section.children = parsePromptSections(content);
    }

    sections.push(section);
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
        <StructuredPrompt prompt={prompt} totalTokens={totalTokens} messageTokens={messageTokens} />
      )}
    </div>
  );
}

// ─── Color map ──────────────────────────────────────────
const typeColor: Record<string, string> = {
  document: accent,
  notes_summary: "#8b5cf6",
  tools: "#f59e0b",
  conversation_summary: "#10b981",
  summary: "#10b981",
  text: "#6b7280",
};

// ─── Section Card ───────────────────────────────────────
function SectionCard({ section, index, depth = 0 }: { section: PromptSectionData; index: number; depth?: number }) {
  const [isOpen, setIsOpen] = useState(false);
  const color = typeColor[section.tag] || "#6b7280";
  const tokens = Math.round(section.content.length / 3.3);

  // Extract first line for summary preview
  const firstLine = section.attrs.path || section.tag;
  const levelLabel = section.attrs.level ? ` [${section.attrs.level}]` : "";
  const label = `${firstLine}${levelLabel}`;

  // For summary children inside conversation_summary, show message range
  const msgRange = section.attrs.messages ? ` · msgs ${section.attrs.messages}` : "";

  return (
    <div style={{
      background: depth > 0 ? "transparent" : "var(--bg)",
      border: depth > 0 ? "none" : "1px solid var(--border)",
      borderRadius: depth > 0 ? 0 : 10,
      marginBottom: depth > 0 ? 2 : 10,
      overflow: "hidden",
      borderTop: depth > 0 ? "1px solid var(--border)" : undefined,
    }}>
      <div
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: depth > 0 ? "8px 14px 8px 24px" : "10px 14px",
          cursor: "pointer",
          borderLeft: `3px solid ${color}`,
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, overflow: "hidden" }}>
          <span style={{
            fontSize: 11,
            color: "var(--text-muted)",
            transition: "transform 0.15s",
            display: "inline-block",
            transform: isOpen ? "rotate(90deg)" : "none",
            flexShrink: 0,
          }}>
            ▶
          </span>
          <span style={{
            fontSize: depth > 0 ? 12 : 13,
            fontWeight: 500,
            color: "var(--text)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}>
            {label}
          </span>
        </div>
        <span style={{
          fontSize: 11,
          fontFamily: "var(--font-mono)",
          color: "var(--text-muted)",
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}>
          {msgRange && <span style={{ marginRight: 8 }}>{msgRange}</span>}
          ~{tokens > 1000 ? `${(tokens / 1000).toFixed(1)}k` : tokens} tokens
        </span>
      </div>
      {isOpen && (
        <div style={{
          borderTop: "1px solid var(--border)",
          ...(section.children && section.children.length > 0
            ? { padding: 0 }
            : { padding: "0 14px 14px" }),
        }}>
          {section.children && section.children.length > 0 ? (
            // Render nested children as sub-cards
            section.children.map((child, i) => (
              <SectionCard key={i} section={child} index={i} depth={depth + 1} />
            ))
          ) : (
            <div
              className="markdown-body"
              style={{ color: "var(--text)", fontSize: 13, lineHeight: 1.6, paddingTop: 12 }}
              dangerouslySetInnerHTML={{ __html: renderMarkdown(section.content) }}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Structured View ────────────────────────────────────
function StructuredPrompt({ prompt, totalTokens, messageTokens }: {
  prompt: string; totalTokens: number; messageTokens?: number;
}) {
  const sections = parsePromptSections(prompt);

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
              }}
              title={`${s.attrs.path || s.tag}: ~${tokens} tokens`}
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
      {sections.map((s, i) => (
        <SectionCard key={i} section={s} index={i} />
      ))}

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
