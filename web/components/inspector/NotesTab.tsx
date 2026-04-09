"use client";

import { useState, useEffect, useCallback } from "react";
import * as api from "../../lib/api";
import { renderMarkdown } from "../../lib/markdown";
import { TabProps, accent, ActionBtn, EmptyState } from "./shared";

export function NotesTab({ baseUrl, token }: TabProps) {
  const [summaries, setSummaries] = useState<any[] | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const load = useCallback(() => {
    api.getSummaries(baseUrl, token).then((d) => {
      setSummaries(Array.isArray(d) ? d : (d?.summaries || []));
    }).catch(() => setSummaries([]));
  }, [baseUrl, token]);

  useEffect(() => { load(); }, [load]);

  if (!summaries) return <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading...</div>;
  if (!summaries.length) return <EmptyState text="No note summaries available" />;

  const toggleExpand = (i: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <ActionBtn
          onClick={() => {
            setRegenerating(true);
            api.regenerateSummary(baseUrl, token).then(load).finally(() => setRegenerating(false));
          }}
          disabled={regenerating}
        >
          ↻ {regenerating ? "Regenerating…" : "Regenerate"}
        </ActionBtn>
      </div>

      {summaries.map((s: any, i: number) => {
        const isOpen = expanded.has(i);
        return (
          <div key={i} style={{
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            marginBottom: 8,
            overflow: "hidden",
          }}>
            <div
              onClick={() => toggleExpand(i)}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "10px 14px",
                cursor: "pointer",
                borderLeft: `3px solid ${accent}`,
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
                  {s.source_key || s.type || `Summary ${i + 1}`}
                </span>
              </div>
              <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
                {s.first_ts ? new Date(s.first_ts).toLocaleDateString() : ""}
                {s.last_ts ? ` — ${new Date(s.last_ts).toLocaleDateString()}` : ""}
              </span>
            </div>
            {isOpen && (
              <div style={{ padding: "0 14px 14px", borderTop: "1px solid var(--border)" }}>
                <div
                  className="markdown-body"
                  style={{ color: "var(--text)", fontSize: 13, lineHeight: 1.6, paddingTop: 12 }}
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(s.text || s.summary || "") }}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
