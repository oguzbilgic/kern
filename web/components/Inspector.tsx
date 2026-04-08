"use client";

import { useState, useEffect, useCallback } from "react";
import * as api from "../lib/api";
import { renderMarkdown } from "../lib/markdown";

interface InspectorProps {
  open: boolean;
  onClose: () => void;
  agentName: string;
  token: string | null;
  serverUrl?: string;
}

type Tab = "sessions" | "segments" | "notes" | "recall" | "context";

const TABS: { key: Tab; label: string }[] = [
  { key: "sessions", label: "Sessions" },
  { key: "segments", label: "Segments" },
  { key: "notes", label: "Notes" },
  { key: "recall", label: "Recall" },
  { key: "context", label: "Context" },
];

// Warm amber accent used throughout the overlay (matches old UI)
const accent = "#e5b567";
const accentDim = "rgba(229, 181, 103, 0.35)";
const accentBg = "rgba(229, 181, 103, 0.12)";
const accentText = "#f0d8a8";

export function Inspector({ open, onClose, agentName, token, serverUrl }: InspectorProps) {
  const [tab, setTab] = useState<Tab>("sessions");

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)", padding: 28 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="flex flex-col overflow-hidden"
        style={{
          width: "min(1400px, calc(100vw - 56px))",
          maxHeight: "calc(100vh - 56px)",
          background: "#202020",
          border: "1px solid var(--border)",
          borderRadius: 14,
          boxShadow: "0 24px 80px rgba(0,0,0,0.5)",
        }}
      >
        {/* Header */}
        <div
          className="flex justify-between items-start gap-4"
          style={{ padding: "22px 24px 16px", borderBottom: "1px solid var(--border)" }}
        >
          <div>
            <h2 style={{ color: "var(--text)", fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Memory</h2>
            <span style={{ color: "var(--text-muted)", fontSize: 12, fontFamily: "var(--font-mono)" }}>
              {TABS.find((t) => t.key === tab)?.label}
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "rgba(255,255,255,0.03)",
              border: "1px solid var(--border)",
              color: "var(--text-dim)",
              fontSize: 18,
              padding: "4px 10px",
              borderRadius: 10,
              cursor: "pointer",
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 0, padding: "0 16px", borderBottom: "1px solid var(--border)" }}>
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                background: "none",
                border: "none",
                borderBottom: `2px solid ${tab === t.key ? accent : "transparent"}`,
                color: tab === t.key ? "var(--text)" : "var(--text-muted)",
                fontSize: 13,
                fontWeight: 500,
                padding: "9px 14px",
                cursor: "pointer",
                transition: "color 0.15s, border-color 0.15s",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Toolbar */}
        <Toolbar tab={tab} agentName={agentName} token={token} serverUrl={serverUrl} />

        {/* Content */}
        <div style={{ flex: 1, overflow: "auto", padding: 20 }}>
          {tab === "sessions" && <SessionsTab agentName={agentName} token={token} serverUrl={serverUrl} />}
          {tab === "segments" && <SegmentsTab agentName={agentName} token={token} serverUrl={serverUrl} />}
          {tab === "notes" && <NotesTab agentName={agentName} token={token} serverUrl={serverUrl} />}
          {tab === "recall" && <RecallTab agentName={agentName} token={token} serverUrl={serverUrl} />}
          {tab === "context" && <ContextTab agentName={agentName} token={token} serverUrl={serverUrl} />}
        </div>
      </div>
    </div>
  );
}

// ─── Shared ─────────────────────────────────────────────
interface TabProps {
  agentName: string;
  token: string | null;
  serverUrl?: string;
}

function Toolbar({ tab, agentName, token, serverUrl }: TabProps & { tab: Tab }) {
  // Only some tabs have toolbar actions
  if (tab === "sessions") return null;
  return null; // Toolbars rendered inside each tab for simplicity
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.03)",
      border: "1px solid var(--border)",
      borderRadius: 10,
      padding: "10px 12px",
      flex: 1,
      minWidth: 100,
    }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", lineHeight: 1.3 }}>{value}</div>
      <div style={{
        fontSize: 10,
        color: "var(--text-muted)",
        textTransform: "uppercase" as const,
        letterSpacing: 0.5,
        fontFamily: "var(--font-mono)",
        marginTop: 2,
      }}>{label}</div>
    </div>
  );
}

function ActionBtn({ onClick, disabled, active, danger, children }: {
  onClick: () => void; disabled?: boolean; active?: boolean; danger?: boolean; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        background: active ? accentBg : "rgba(255,255,255,0.04)",
        border: `1px solid ${active ? accentDim : "var(--border)"}`,
        color: active ? accentText : "var(--text-dim)",
        fontSize: 12,
        fontWeight: 500,
        letterSpacing: 0.2,
        cursor: disabled ? "default" : "pointer",
        padding: "4px 10px",
        borderRadius: 20,
        transition: "all 0.15s",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div style={{ color: "var(--text-muted)", fontSize: 13, textAlign: "center", padding: "40px 0" }}>{text}</div>;
}

// ─── Sessions Tab ───────────────────────────────────────
function SessionsTab({ agentName, token, serverUrl }: TabProps) {
  const [data, setData] = useState<{ sessions: any[]; currentSessionId: string | null } | null>(null);
  const [activity, setActivity] = useState<any>(null);
  const [activeSession, setActiveSession] = useState<string | null>(null);

  useEffect(() => {
    api.getSessions(agentName, token, serverUrl).then((d) => {
      if (d?.sessions) {
        setData(d);
        setActiveSession(d.currentSessionId || d.sessions?.[0]?.session_id || null);
      } else {
        setData({ sessions: [], currentSessionId: null });
      }
    }).catch(() => setData({ sessions: [], currentSessionId: null }));
  }, [agentName, token, serverUrl]);

  useEffect(() => {
    if (activeSession) {
      api.getSessionActivity(agentName, token, serverUrl, activeSession).then(setActivity).catch(() => {});
    }
  }, [agentName, token, serverUrl, activeSession]);

  if (!data) return <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading...</div>;
  if (!data.sessions.length) return <EmptyState text="No session data available" />;

  return (
    <div>
      {data.sessions.map((s: any) => {
        const isLive = s.session_id === data.currentSessionId;
        const isActive = activeSession === s.session_id;
        return (
          <div
            key={s.session_id}
            onClick={() => setActiveSession(s.session_id)}
            style={{
              background: isActive ? "var(--bg-sidebar)" : "rgba(255,255,255,0.02)",
              border: `1px ${isActive ? "solid" : "dashed"} ${isActive ? accentDim : "var(--border)"}`,
              borderRadius: isActive ? 10 : 8,
              padding: isActive ? 16 : "10px 14px",
              marginBottom: isActive ? 12 : 8,
              cursor: "pointer",
              transition: "background 0.15s",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: isActive ? 10 : 4 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: isActive ? accent : "var(--text)" }}>
                  {s.session_id?.slice(0, 8)}
                </span>
                {isLive && (
                  <span style={{ fontSize: 10, color: "#4ade80", fontWeight: 600 }}>● live</span>
                )}
              </div>
              <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                {s.messages?.toLocaleString() ?? "?"} messages
              </span>
            </div>
            {s.first_ts && (
              <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                {new Date(s.first_ts).toLocaleDateString()} — {s.last_ts ? new Date(s.last_ts).toLocaleDateString() : "now"}
              </div>
            )}
          </div>
        );
      })}

      {activity?.daily?.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" as const, letterSpacing: 0.5, marginBottom: 4 }}>
            Daily activity
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: 2,
              height: 80,
              background: "rgba(0,0,0,0.15)",
              borderRadius: 6,
              padding: 8,
            }}
          >
            {(() => {
              const max = Math.max(...activity.daily.map((d: any) => d.count), 1);
              return activity.daily.map((d: any, i: number) => (
                <div
                  key={i}
                  style={{
                    flex: 1,
                    background: accent,
                    opacity: 0.5,
                    borderRadius: "2px 2px 0 0",
                    height: `${(d.count / max) * 100}%`,
                    minHeight: d.count > 0 ? 2 : 0,
                    transition: "height 0.3s",
                  }}
                  title={`${d.date}: ${d.count}`}
                />
              ));
            })()}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Segments Tab ───────────────────────────────────────
function SegmentsTab({ agentName, token, serverUrl }: TabProps) {
  const [segments, setSegments] = useState<any>(null);
  const [contextIds, setContextIds] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<"all" | "context">("all");
  const [selected, setSelected] = useState<any>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [resummarizing, setResummarizing] = useState(false);

  const load = useCallback(() => {
    api.getSegments(agentName, token, serverUrl).then(setSegments).catch(() => setSegments({ segments: [] }));
    api.getContextSegments(agentName, token, serverUrl).then((d) => {
      if (d?.segments) setContextIds(new Set(d.segments.map((s: any) => s.id)));
    }).catch(() => {});
  }, [agentName, token, serverUrl]);

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
      <div style={{ flex: 1, minWidth: 0, overflow: "auto", paddingRight: selected ? 20 : 0 }}>
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
              onClick={() => { if (confirm("Rebuild segments from scratch?")) { setRebuilding(true); api.rebuildSegments(agentName, token, serverUrl).finally(() => { setRebuilding(false); load(); }); } }}
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
                // Color coding: context segments use amber, others use neutral
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

      {/* Right: detail panel */}
      {selected && (
        <div style={{
          width: 520,
          flexShrink: 0,
          borderLeft: "1px solid var(--border)",
          padding: "18px 20px",
          overflowY: "auto",
          background: "var(--bg-sidebar)",
        }}>
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
                api.resummarizeSegment(agentName, token, serverUrl, selected.id)
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
        </div>
      )}
    </div>
  );
}

// ─── Notes Tab ──────────────────────────────────────────
function NotesTab({ agentName, token, serverUrl }: TabProps) {
  const [summaries, setSummaries] = useState<any[] | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const load = useCallback(() => {
    api.getSummaries(agentName, token, serverUrl).then((d) => {
      setSummaries(Array.isArray(d) ? d : (d?.summaries || []));
    }).catch(() => setSummaries([]));
  }, [agentName, token, serverUrl]);

  useEffect(() => { load(); }, [load]);

  if (summaries === null) return <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading...</div>;
  if (!summaries.length) return <EmptyState text="No notes summaries available" />;

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
          onClick={() => { setRegenerating(true); api.regenerateSummary(agentName, token, serverUrl).finally(() => { setRegenerating(false); load(); }); }}
          disabled={regenerating}
        >
          ↻ {regenerating ? "Regenerating…" : "Regenerate"}
        </ActionBtn>
      </div>
      {summaries.map((s: any, i: number) => {
        const isExpanded = expanded.has(i);
        const isCurrent = i === 0;
        return (
          <div key={i} style={{
            background: "var(--bg)",
            border: `1px solid ${isCurrent ? accentDim : "var(--border)"}`,
            borderRadius: 10,
            padding: 16,
            marginBottom: 12,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                  {s.source_key || s.type}
                </span>
                {isCurrent && (
                  <span style={{
                    background: accentBg, color: accent,
                    padding: "2px 8px", borderRadius: 4,
                    fontSize: 10, fontWeight: 600,
                  }}>
                    CURRENT
                  </span>
                )}
              </div>
              {s.date_start && (
                <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                  {s.date_start} → {s.date_end}
                </span>
              )}
            </div>
            <div
              onClick={() => toggleExpand(i)}
              style={{
                color: "var(--text)",
                fontSize: 13,
                lineHeight: 1.6,
                whiteSpace: "pre-wrap" as const,
                wordBreak: "break-word" as const,
                maxHeight: isExpanded ? "none" : 200,
                overflow: "hidden",
                cursor: "pointer",
                position: "relative" as const,
              }}
              className="markdown-body"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(s.text || s.content || "") }}
            />
            {!isExpanded && (s.text || s.content || "").length > 400 && (
              <div style={{
                height: 40,
                background: "linear-gradient(transparent, var(--bg))",
                marginTop: -40,
                position: "relative" as const,
                pointerEvents: "none" as const,
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Recall Tab ─────────────────────────────────────────
function RecallTab({ agentName, token, serverUrl }: TabProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[] | null>(null);
  const [stats, setStats] = useState<any>(null);
  const [searching, setSearching] = useState(false);
  const [expandedResults, setExpandedResults] = useState<Set<number>>(new Set());

  useEffect(() => {
    api.getRecallStats(agentName, token, serverUrl).then(setStats).catch(() => setStats(null));
  }, [agentName, token, serverUrl]);

  const search = () => {
    if (!query.trim()) return;
    setSearching(true);
    setExpandedResults(new Set());
    api.recallSearch(agentName, token, serverUrl, query)
      .then((d) => setResults(d?.results || []))
      .catch(() => setResults([]))
      .finally(() => setSearching(false));
  };

  const toggleResult = (i: number) => {
    setExpandedResults((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  };

  return (
    <div>
      {/* Stats */}
      {stats && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
          <StatCard label="Messages" value={stats.messages?.toLocaleString() ?? 0} />
          <StatCard label="Chunks" value={stats.chunks?.toLocaleString() ?? 0} />
          <StatCard label="Sessions" value={stats.sessions ?? 0} />
        </div>
      )}

      {/* Search box */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="Search past conversations…"
          style={{
            flex: 1,
            background: "var(--bg)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 8,
            padding: "8px 12px",
            color: "var(--text)",
            fontSize: 13,
            outline: "none",
            fontFamily: "inherit",
          }}
        />
        <ActionBtn onClick={search} disabled={searching || !query.trim()}>
          {searching ? "Searching…" : "Search"}
        </ActionBtn>
      </div>

      {/* Results */}
      {results !== null && results.length === 0 && (
        <EmptyState text="No results found" />
      )}
      {results?.map((r: any, i: number) => {
        const isExpanded = expandedResults.has(i);
        const relevance = Math.round((1 - (r.distance || 0)) * 100);
        const barWidth = Math.max(4, relevance * 0.6);
        return (
          <div key={i} style={{
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 10,
            padding: 14,
            marginBottom: 10,
          }}>
            <div style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 11,
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono)",
              marginBottom: 6,
            }}>
              <span>msgs {r.msg_start}–{r.msg_end}</span>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {relevance}%
                <span style={{
                  display: "inline-block",
                  height: 4,
                  borderRadius: 2,
                  background: accent,
                  width: barWidth,
                  verticalAlign: "middle",
                }} />
              </span>
            </div>
            <div
              onClick={() => toggleResult(i)}
              style={{
                color: "var(--text)",
                fontSize: 13,
                lineHeight: 1.5,
                whiteSpace: "pre-wrap" as const,
                wordBreak: "break-word" as const,
                maxHeight: isExpanded ? "none" : 150,
                overflow: "hidden",
                cursor: "pointer",
                position: "relative" as const,
              }}
            >
              {r.text}
            </div>
            {!isExpanded && r.text?.length > 300 && (
              <div style={{
                height: 40,
                background: "linear-gradient(transparent, var(--bg))",
                marginTop: -40,
                position: "relative" as const,
                pointerEvents: "none" as const,
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Context Tab ────────────────────────────────────────
function ContextTab({ agentName, token, serverUrl }: TabProps) {
  const [prompt, setPrompt] = useState<string | null>(null);
  const [view, setView] = useState<"structured" | "raw">("structured");

  useEffect(() => {
    api.getSystemPrompt(agentName, token, serverUrl).then(setPrompt).catch(() => {});
  }, [agentName, token, serverUrl]);

  if (prompt === null) return <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading...</div>;

  const totalTokens = Math.round(prompt.length / 3.3);

  return (
    <div>
      {/* Toggle + stats */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
          ~{totalTokens.toLocaleString()} tokens
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
        <StructuredPrompt prompt={prompt} totalTokens={totalTokens} />
      )}
    </div>
  );
}

function StructuredPrompt({ prompt, totalTokens }: { prompt: string; totalTokens: number }) {
  const sections = parsePromptSections(prompt);
  const [openSections, setOpenSections] = useState<Set<number>>(new Set());

  const toggle = (i: number) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  };

  // Color per section type
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
    </div>
  );
}

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
