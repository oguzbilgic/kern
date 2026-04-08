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

export function Inspector({ open, onClose, agentName, token, serverUrl }: InspectorProps) {
  const [tab, setTab] = useState<Tab>("sessions");

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="flex flex-col bg-[var(--bg)] border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden"
        style={{ width: "90vw", maxWidth: 960, height: "85vh" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)] bg-[var(--bg-sidebar)]">
          <div className="flex items-center gap-5">
            <span className="text-sm font-semibold text-[var(--text)]">Memory</span>
            <div className="flex">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
                    tab === t.key
                      ? "border-[var(--accent)] text-[var(--text)]"
                      : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-dim)]"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-surface)] transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
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

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col items-center px-4 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] min-w-[80px]">
      <span className="text-base font-semibold text-[var(--text)] tabular-nums">{value}</span>
      <span className="text-[10px] text-[var(--text-muted)] mt-0.5">{label}</span>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="text-sm text-[var(--text-muted)] text-center py-8">{text}</div>;
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
        active
          ? "bg-[var(--accent)]/15 text-[var(--accent)] font-medium"
          : "text-[var(--text-muted)] hover:text-[var(--text-dim)]"
      }`}
    >
      {children}
    </button>
  );
}

function ActionBtn({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="px-3 py-1 text-[11px] rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-surface)] transition-colors disabled:opacity-40"
    >
      {children}
    </button>
  );
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
        const first = d.currentSessionId || d.sessions?.[0]?.session_id;
        setActiveSession(first ?? null);
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

  if (!data) return <div className="text-[var(--text-muted)] text-sm">Loading...</div>;
  if (!data.sessions.length) return <EmptyState text="No session data available" />;

  return (
    <div className="space-y-4">
      {data.sessions.map((s: any) => {
        const isLive = s.session_id === data.currentSessionId;
        const isActive = activeSession === s.session_id;
        return (
          <button
            key={s.session_id}
            onClick={() => setActiveSession(s.session_id)}
            className={`w-full text-left px-4 py-3 rounded-lg border transition-all ${
              isActive
                ? "border-[var(--accent)]/50 bg-[var(--bg-surface)]"
                : "border-[var(--border)] bg-transparent hover:bg-[var(--bg-surface)]/50"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-sm font-mono text-[var(--text)]">
                  {s.session_id?.slice(0, 8)}
                </span>
                {isLive && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-green-400 font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                    live
                  </span>
                )}
              </div>
              <span className="text-xs text-[var(--text-muted)] tabular-nums">
                {s.messages?.toLocaleString() ?? "?"} msgs
              </span>
            </div>
            {s.first_ts && (
              <div className="text-[10px] text-[var(--text-muted)] mt-1">
                {new Date(s.first_ts).toLocaleDateString()} — {s.last_ts ? new Date(s.last_ts).toLocaleDateString() : "now"}
              </div>
            )}
          </button>
        );
      })}

      {activity?.daily?.length > 0 && (
        <div>
          <div className="text-[11px] text-[var(--text-muted)] mb-2 font-medium">Daily activity</div>
          <ActivityChart data={activity.daily} />
        </div>
      )}
    </div>
  );
}

function ActivityChart({ data }: { data: { date: string; count: number }[] }) {
  if (!data.length) return null;
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="flex items-end gap-[2px] rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] p-3" style={{ height: 80 }}>
      {data.map((d, i) => (
        <div
          key={i}
          className="flex-1 bg-[var(--accent)] rounded-t-sm transition-all hover:opacity-100 opacity-50"
          style={{ height: `${(d.count / max) * 100}%`, minHeight: d.count > 0 ? 2 : 0 }}
          title={`${d.date}: ${d.count}`}
        />
      ))}
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

  const load = useCallback(() => {
    api.getSegments(agentName, token, serverUrl).then(setSegments).catch(() => setSegments({ segments: [] }));
    api.getContextSegments(agentName, token, serverUrl).then((d) => {
      if (d?.segments) setContextIds(new Set(d.segments.map((s: any) => s.id)));
    }).catch(() => {});
  }, [agentName, token, serverUrl]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const iv = setInterval(load, 5000); return () => clearInterval(iv); }, [load]);

  if (!segments) return <div className="text-[var(--text-muted)] text-sm">Loading...</div>;

  const allSegs: any[] = segments.segments || [];
  if (!allSegs.length) return <EmptyState text="No segments available" />;

  const filtered = filter === "context"
    ? allSegs.filter((s: any) => contextIds.has(s.id))
    : allSegs;

  // Group by level
  const levels = new Map<number, any[]>();
  for (const s of filtered) {
    const l = s.level ?? 0;
    if (!levels.has(l)) levels.set(l, []);
    levels.get(l)!.push(s);
  }
  const sortedLevels = [...levels.keys()].sort((a, b) => b - a);

  // Stats
  const totalTokens = allSegs.reduce((sum: number, s: any) => sum + (s.token_count || 0), 0);
  const summarized = allSegs.filter((s: any) => s.summary).length;

  return (
    <div className="space-y-4">
      {/* Stats + Controls */}
      <div className="flex items-center justify-between">
        <div className="flex gap-3">
          <StatCard label="segments" value={allSegs.length} />
          <StatCard label="summarized" value={summarized} />
          <StatCard label="tokens" value={totalTokens > 1000 ? `${(totalTokens/1000).toFixed(0)}k` : totalTokens} />
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-0.5">
            <Pill active={filter === "all"} onClick={() => setFilter("all")}>All</Pill>
            <Pill active={filter === "context"} onClick={() => setFilter("context")}>Context</Pill>
          </div>
          <ActionBtn
            onClick={() => { if (confirm("Rebuild all segments?")) { setRebuilding(true); api.rebuildSegments(agentName, token, serverUrl).finally(() => { setRebuilding(false); load(); }); }}}
            disabled={rebuilding}
          >
            {rebuilding ? "Rebuilding…" : "Rebuild"}
          </ActionBtn>
        </div>
      </div>

      {/* Segment blocks by level */}
      {sortedLevels.map((level) => (
        <div key={level}>
          <div className="text-[11px] text-[var(--text-muted)] mb-1.5 font-medium">
            L{level} <span className="font-normal">· {levels.get(level)!.length} segments</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {levels.get(level)!.map((s: any) => {
              const tokens = s.token_count || 0;
              const isContext = contextIds.has(s.id);
              const isSelected = selected?.id === s.id;
              // Color intensity by token density
              const intensity = Math.min(1, tokens / 15000);
              const bg = isSelected
                ? "var(--accent)"
                : isContext
                  ? `rgba(252, 213, 58, ${0.15 + intensity * 0.25})`
                  : `rgba(255, 255, 255, ${0.03 + intensity * 0.08})`;
              return (
                <button
                  key={s.id}
                  onClick={() => setSelected(s)}
                  className={`rounded-sm transition-all border ${
                    isSelected
                      ? "border-[var(--accent)]"
                      : isContext
                        ? "border-[var(--accent)]/30"
                        : "border-[var(--border)] hover:border-[var(--text-muted)]"
                  }`}
                  style={{
                    width: Math.max(24, Math.min(80, Math.sqrt(tokens) * 0.7)),
                    height: 24,
                    background: bg,
                    opacity: isSelected ? 1 : 0.85,
                  }}
                  title={`msgs ${s.msg_start}–${s.msg_end} · ${tokens} tokens`}
                />
              );
            })}
          </div>
        </div>
      ))}

      {/* Detail panel */}
      {selected && (
        <div className="p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]">
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="text-xs font-medium text-[var(--text)]">
                L{selected.level} · messages {selected.msg_start}–{selected.msg_end}
              </div>
              <div className="text-[10px] text-[var(--text-muted)] mt-0.5">
                {selected.token_count?.toLocaleString()} tokens
                {selected.summary_token_count ? ` → ${selected.summary_token_count} summary tokens (${Math.round(selected.token_count / selected.summary_token_count)}:1)` : ""}
              </div>
              {selected.start_time && (
                <div className="text-[10px] text-[var(--text-muted)] mt-0.5">
                  {new Date(selected.start_time).toLocaleString()} — {selected.end_time ? new Date(selected.end_time).toLocaleString() : "now"}
                </div>
              )}
            </div>
            <ActionBtn
              onClick={() => api.resummarizeSegment(agentName, token, serverUrl, selected.id).then(load)}
            >
              Resummarize
            </ActionBtn>
          </div>
          {selected.summary ? (
            <div
              className="text-xs text-[var(--text)] markdown-body leading-relaxed"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(selected.summary) }}
            />
          ) : (
            <div className="text-xs text-[var(--text-muted)] italic">No summary yet</div>
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
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = useCallback(() => {
    api.getSummaries(agentName, token, serverUrl).then((d) => {
      setSummaries(Array.isArray(d) ? d : (d?.summaries || []));
    }).catch(() => setSummaries([]));
  }, [agentName, token, serverUrl]);

  useEffect(() => { load(); }, [load]);

  if (summaries === null) return <div className="text-[var(--text-muted)] text-sm">Loading...</div>;
  if (!summaries.length) return <EmptyState text="No notes summaries available" />;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-[var(--text-muted)] font-medium">{summaries.length} summaries</span>
        <ActionBtn
          onClick={() => { setRegenerating(true); api.regenerateSummary(agentName, token, serverUrl).finally(() => { setRegenerating(false); load(); }); }}
          disabled={regenerating}
        >
          {regenerating ? "Regenerating…" : "Regenerate"}
        </ActionBtn>
      </div>
      {summaries.map((s: any, i: number) => (
        <div key={i} className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] overflow-hidden">
          <button
            onClick={() => setExpanded(expanded === i ? null : i)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-[var(--bg)]/30 transition-colors"
          >
            <span className="text-xs font-medium text-[var(--text)]">{s.source_key || s.type}</span>
            <div className="flex items-center gap-3">
              {s.date_start && (
                <span className="text-[10px] text-[var(--text-muted)]">{s.date_start} → {s.date_end}</span>
              )}
              <span className="text-[10px] text-[var(--text-muted)]">{expanded === i ? "▼" : "▶"}</span>
            </div>
          </button>
          {expanded === i && (
            <div className="px-4 pb-3 border-t border-[var(--border)]">
              <div
                className="text-xs text-[var(--text)] markdown-body mt-2 leading-relaxed"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(s.text || s.content || "") }}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Recall Tab ─────────────────────────────────────────
function RecallTab({ agentName, token, serverUrl }: TabProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[] | null>(null);
  const [stats, setStats] = useState<any>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    api.getRecallStats(agentName, token, serverUrl).then(setStats).catch(() => setStats(null));
  }, [agentName, token, serverUrl]);

  const search = () => {
    if (!query.trim()) return;
    setSearching(true);
    api.recallSearch(agentName, token, serverUrl, query)
      .then((d) => setResults(d?.results || []))
      .catch(() => setResults([]))
      .finally(() => setSearching(false));
  };

  return (
    <div className="space-y-4">
      {/* Stats */}
      {stats && (
        <div className="flex gap-3">
          <StatCard label="messages" value={stats.messages?.toLocaleString() ?? 0} />
          <StatCard label="chunks" value={stats.chunks?.toLocaleString() ?? 0} />
          <StatCard label="sessions" value={stats.sessions ?? 0} />
          {stats.first_ts && (
            <StatCard
              label="range"
              value={`${new Date(stats.first_ts).toLocaleDateString()} →`}
            />
          )}
        </div>
      )}

      {/* Search */}
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="Search past conversations…"
          className="flex-1 px-3 py-2 text-sm rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)] transition-colors"
        />
        <button
          onClick={search}
          disabled={searching || !query.trim()}
          className="px-4 py-2 text-xs font-medium rounded-lg bg-[var(--accent)]/15 text-[var(--accent)] hover:bg-[var(--accent)]/25 transition-colors disabled:opacity-40"
        >
          {searching ? "Searching…" : "Search"}
        </button>
      </div>

      {/* Results */}
      {results !== null && results.length === 0 && (
        <div className="text-sm text-[var(--text-muted)] text-center py-4">No results found</div>
      )}
      {results?.map((r: any, i: number) => (
        <div key={i} className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border)] bg-[var(--bg)]/30">
            <span className="text-[10px] text-[var(--text-muted)] font-mono">
              msgs {r.msg_start}–{r.msg_end}
            </span>
            <span className="text-[10px] text-[var(--text-muted)]">
              relevance {(1 - (r.distance || 0)).toFixed(0)}%
            </span>
          </div>
          <div className="px-4 py-3">
            <div className="text-xs text-[var(--text)] whitespace-pre-wrap leading-relaxed">
              {r.text?.slice(0, 600)}
              {r.text?.length > 600 && <span className="text-[var(--text-muted)]">…</span>}
            </div>
          </div>
        </div>
      ))}
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

  if (prompt === null) return <div className="text-[var(--text-muted)] text-sm">Loading...</div>;

  const totalTokens = Math.round(prompt.length / 3.3);

  if (view === "raw") {
    return (
      <div>
        <div className="flex items-center justify-between mb-3">
          <span className="text-[11px] text-[var(--text-muted)]">~{totalTokens.toLocaleString()} tokens</span>
          <ViewToggle view={view} setView={setView} />
        </div>
        <pre className="text-xs text-[var(--text)] whitespace-pre-wrap break-words bg-[var(--bg-surface)] p-4 rounded-lg border border-[var(--border)] max-h-[60vh] overflow-y-auto font-mono leading-relaxed">
          {prompt}
        </pre>
      </div>
    );
  }

  const sections = parsePromptSections(prompt);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-[var(--text-muted)]">~{totalTokens.toLocaleString()} tokens</span>
          <span className="text-[11px] text-[var(--text-muted)]">·</span>
          <span className="text-[11px] text-[var(--text-muted)]">{sections.length} sections</span>
        </div>
        <ViewToggle view={view} setView={setView} />
      </div>
      <div className="space-y-2">
        {sections.map((s, i) => (
          <PromptSection key={i} section={s} />
        ))}
      </div>
    </div>
  );
}

function ViewToggle({ view, setView }: { view: "structured" | "raw"; setView: (v: "structured" | "raw") => void }) {
  return (
    <div className="flex gap-0.5 rounded-md bg-[var(--bg-surface)] p-0.5">
      {(["structured", "raw"] as const).map((v) => (
        <button
          key={v}
          onClick={() => setView(v)}
          className={`px-2.5 py-1 text-[11px] rounded transition-colors ${
            view === v
              ? "bg-[var(--bg)] text-[var(--text)] shadow-sm"
              : "text-[var(--text-muted)] hover:text-[var(--text-dim)]"
          }`}
        >
          {v === "structured" ? "Structured" : "Raw"}
        </button>
      ))}
    </div>
  );
}

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
    const attrStr = match[2];
    const attrRegex = /(\w+)="([^"]*)"/g;
    let am;
    while ((am = attrRegex.exec(attrStr)) !== null) {
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

function PromptSection({ section }: { section: PromptSectionData }) {
  const [open, setOpen] = useState(false);
  const label = section.attrs.path || section.tag;
  const tokens = Math.round(section.content.length / 3.3);
  const maxWidth = 100;
  const barWidth = Math.min(maxWidth, Math.max(4, (tokens / 500) * maxWidth));

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-[var(--bg)]/30 transition-colors"
      >
        <span className="text-[10px] text-[var(--text-muted)] w-3">{open ? "▼" : "▶"}</span>
        <span className="text-xs font-medium text-[var(--text)] flex-1">{label}</span>
        <div className="flex items-center gap-2">
          <div className="h-1 rounded-full bg-[var(--accent)]/30 overflow-hidden" style={{ width: maxWidth }}>
            <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: barWidth }} />
          </div>
          <span className="text-[10px] text-[var(--text-muted)] tabular-nums w-14 text-right">
            {tokens > 1000 ? `${(tokens/1000).toFixed(1)}k` : tokens}
          </span>
        </div>
      </button>
      {open && (
        <div className="px-4 pb-3 border-t border-[var(--border)]">
          <div
            className="text-xs text-[var(--text)] markdown-body mt-2 leading-relaxed"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(section.content) }}
          />
        </div>
      )}
    </div>
  );
}
