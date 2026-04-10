"use client";

import { useState, useEffect, useCallback } from "react";
import * as api from "../../lib/api";
import { renderMarkdown } from "../../lib/markdown";
import { TabProps, accent, accentDim, StatCard, ActionBtn, EmptyState } from "./shared";

export function SegmentsTab({ baseUrl, token }: TabProps) {
  const [segments, setSegments] = useState<any>(null);
  const [contextIds, setContextIds] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<"all" | "context">("context");
  const [selected, setSelected] = useState<any>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [resummarizing, setResummarizing] = useState(false);

  const load = useCallback(() => {
    api.getSegments(baseUrl, token).then(setSegments).catch(() => setSegments({ segments: [] }));
    api.getContextSegments(baseUrl, token).then((d) => {
      if (d?.segments) setContextIds(new Set(d.segments.map((s: any) => s.id)));
    }).catch(() => {});
  }, [baseUrl, token]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const iv = setInterval(load, 5000); return () => clearInterval(iv); }, [load]);

  if (!segments) return <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading...</div>;

  const allSegs: any[] = segments.segments || [];
  if (!allSegs.length) return <EmptyState text="No segments available" />;

  const filtered = filter === "context" ? allSegs.filter((s: any) => contextIds.has(s.id)) : allSegs;

  const levels = new Map<number, any[]>();
  for (const s of filtered) {
    const l = s.level ?? 0;
    if (!levels.has(l)) levels.set(l, []);
    levels.get(l)!.push(s);
  }
  const sortedLevels = [...levels.keys()].sort((a, b) => b - a);

  const totalTokens = allSegs.reduce((sum: number, s: any) => sum + (s.token_count || 0), 0);
  const summarized = allSegs.filter((s: any) => s.summary).length;

  return (
    <div style={{ display: "flex", gap: 0, minHeight: 400 }}>
      {/* Left: timeline */}
      <div style={{ flex: 1, minWidth: 0, overflow: "auto", paddingRight: 20 }}>
        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 16 }}>
          <StatCard label="Segments" value={allSegs.length} />
          <StatCard label="Summarized" value={summarized} />
          <StatCard label="Total Tokens" value={totalTokens > 1000 ? `${(totalTokens / 1000).toFixed(0)}k` : totalTokens} />
          <StatCard label="In Context" value={contextIds.size} />
        </div>

        {/* Filters + Actions */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 6 }}>
            <ActionBtn active={filter === "all"} onClick={() => setFilter("all")}>All</ActionBtn>
            <ActionBtn active={filter === "context"} onClick={() => setFilter("context")}>In context</ActionBtn>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <ActionBtn
              onClick={() => { if (confirm("Rebuild segments from scratch?")) { setRebuilding(true); api.rebuildSegments(baseUrl, token).finally(() => { setRebuilding(false); load(); }); } }}
              disabled={rebuilding}
            >
              ↻ {rebuilding ? "Rebuilding…" : "Rebuild"}
            </ActionBtn>
          </div>
        </div>

        {/* Segment blocks */}
        {sortedLevels.map((level) => (
          <div key={level} style={{ marginBottom: 16 }}>
            <div style={{
              color: "var(--text-muted)", fontSize: 11, fontFamily: "var(--font-mono)",
              textTransform: "uppercase" as const, letterSpacing: 0.5, marginBottom: 6,
            }}>
              L{level} · {levels.get(level)!.length} segments
            </div>
            <div style={{ display: "flex", gap: 2, flexWrap: "wrap", alignItems: "flex-end" }}>
              {levels.get(level)!.map((s: any) => {
                const tokens = s.token_count || 0;
                const isContext = contextIds.has(s.id);
                const isSelected = selected?.id === s.id;
                const intensity = Math.min(1, tokens / 15000);
                const bgColor = isContext
                  ? `rgba(229, 181, 103, ${0.15 + intensity * 0.35})`
                  : `rgba(255, 255, 255, ${0.04 + intensity * 0.1})`;
                const h = Math.max(24, Math.min(48, Math.sqrt(tokens) * 0.5));
                return (
                  <div
                    key={s.id}
                    onClick={() => setSelected(s)}
                    style={{
                      width: Math.max(20, Math.min(80, Math.sqrt(tokens) * 0.7)),
                      height: h,
                      background: bgColor,
                      borderRadius: 3,
                      cursor: "pointer",
                      outline: isSelected ? "2px solid #fff" : "none",
                      outlineOffset: -2,
                      opacity: s.summary ? (isSelected ? 1 : 0.85) : 0.5,
                      border: s.summary ? "none" : "1px dashed rgba(255,255,255,0.3)",
                      transition: "opacity 0.15s",
                      display: "flex",
                      alignItems: "flex-end",
                      justifyContent: "center",
                      padding: "0 2px 2px",
                      fontSize: 10,
                      fontFamily: "var(--font-mono)",
                      color: "rgba(255,255,255,0.6)",
                    }}
                    title={`msgs ${s.msg_start}–${s.msg_end} · ${tokens} tokens`}
                  >
                    {tokens > 3000 ? `${(tokens / 1000).toFixed(0)}k` : ""}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Right: detail panel — always visible */}
      <div style={{
        width: 520,
        flexShrink: 0,
        borderLeft: "1px solid var(--border)",
        padding: "18px 20px",
        overflowY: "auto",
        background: "var(--bg-sidebar)",
      }}>
        {selected ? (
          <>
            <div style={{ marginBottom: 14 }}>
              <div style={{ color: "var(--text)", fontSize: 16, fontWeight: 600, lineHeight: 1.3, marginBottom: 8 }}>
                L{selected.level} Segment
              </div>
              <div style={{ color: "var(--text-muted)", fontSize: 12, fontFamily: "var(--font-mono)", lineHeight: 1.6 }}>
                Messages {selected.msg_start}–{selected.msg_end}
                <br />
                {selected.token_count?.toLocaleString()} tokens
                {selected.summary_token_count ? ` → ${selected.summary_token_count} summary tokens (${Math.round(selected.token_count / selected.summary_token_count)}:1 compression)` : ""}
              </div>
            </div>

            {selected.start_time && (
              <div style={{ color: "var(--text-muted)", fontSize: 12, fontFamily: "var(--font-mono)", lineHeight: 1.5, marginBottom: 12 }}>
                {new Date(selected.start_time).toLocaleString()} —<br />
                {selected.end_time ? new Date(selected.end_time).toLocaleString() : "now"}
              </div>
            )}

            <div style={{ marginBottom: 12, display: "flex", gap: 8 }}>
              <ActionBtn
                onClick={() => {
                  setResummarizing(true);
                  api.resummarizeSegment(baseUrl, token, selected.id)
                    .then(load)
                    .finally(() => setResummarizing(false));
                }}
                disabled={resummarizing}
              >
                ↻ {resummarizing ? "Resummarizing…" : "Resummarize"}
              </ActionBtn>
            </div>

            {selected.summary ? (
              <div
                style={{ color: "var(--text)", fontSize: 13, lineHeight: 1.6 }}
                className="markdown-body"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(selected.summary) }}
              />
            ) : (
              <div style={{ color: "var(--text-muted)", fontSize: 13, fontStyle: "italic" }}>No summary yet</div>
            )}
          </>
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-muted)", fontSize: 13 }}>
            Click a segment to view details
          </div>
        )}
      </div>
    </div>
  );
}
