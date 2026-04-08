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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        className="flex flex-col bg-[var(--bg)] border border-[var(--border)] rounded-lg shadow-2xl"
        style={{ width: "90vw", maxWidth: 900, height: "80vh" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <div className="flex items-center gap-4">
            <span className="text-sm font-semibold text-[var(--text)]">Memory</span>
            <div className="flex gap-1">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`px-2.5 py-1 text-xs rounded transition-colors ${
                    tab === t.key
                      ? "bg-[var(--bg-surface)] text-[var(--text)]"
                      : "text-[var(--text-muted)] hover:text-[var(--text)]"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text)] text-lg leading-none"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
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

// ─── Tab Props ──────────────────────────────────────────
interface TabProps {
  agentName: string;
  token: string | null;
  serverUrl?: string;
}

// ─── Sessions Tab ───────────────────────────────────────
function SessionsTab({ agentName, token, serverUrl }: TabProps) {
  const [data, setData] = useState<{ sessions: any[]; currentSessionId: string | null } | null>(null);
  const [activity, setActivity] = useState<any>(null);
  const [activeSession, setActiveSession] = useState<string | null>(null);

  useEffect(() => {
    api.getSessions(agentName, token).then((d) => {
      setData(d);
      setActiveSession(d.currentSessionId || (d.sessions?.[0]?.id ?? null));
    }).catch(() => {});
  }, [agentName, token]);

  useEffect(() => {
    if (activeSession) {
      api.getSessionActivity(agentName, token, activeSession).then(setActivity).catch(() => {});
    }
  }, [agentName, token, activeSession]);

  if (!data) return <div className="text-[var(--text-muted)] text-sm">Loading...</div>;

  return (
    <div className="space-y-3">
      {data.sessions.map((s: any) => (
        <button
          key={s.id}
          onClick={() => setActiveSession(s.id)}
          className={`w-full text-left px-3 py-2 rounded border transition-colors ${
            activeSession === s.id
              ? "border-[var(--accent)] bg-[var(--bg-surface)]"
              : "border-[var(--border)] bg-transparent hover:bg-[var(--bg-surface)]"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm text-[var(--text)]">
              {s.id?.slice(0, 8)}
              {s.id === data.currentSessionId && (
                <span className="ml-2 text-xs text-green-400">● live</span>
              )}
            </span>
            <span className="text-xs text-[var(--text-muted)]">
              {s.messageCount ?? "?"} messages
            </span>
          </div>
        </button>
      ))}

      {activity && (
        <div className="mt-4">
          <div className="text-xs text-[var(--text-muted)] mb-2">Daily activity</div>
          <ActivityChart data={activity.daily || []} />
        </div>
      )}
    </div>
  );
}

function ActivityChart({ data }: { data: { date: string; count: number }[] }) {
  if (!data.length) return null;
  const max = Math.max(...data.map((d) => d.count), 1);
  return (
    <div className="flex items-end gap-px" style={{ height: 60 }}>
      {data.map((d, i) => (
        <div
          key={i}
          className="flex-1 bg-[var(--accent)] opacity-60 rounded-t-sm"
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
    api.getSegments(agentName, token).then(setSegments).catch(() => {});
    api.getContextSegments(agentName, token).then((d) => {
      if (d?.segments) setContextIds(new Set(d.segments.map((s: any) => s.id)));
    }).catch(() => {});
  }, [agentName, token]);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh while open
  useEffect(() => {
    const iv = setInterval(load, 5000);
    return () => clearInterval(iv);
  }, [load]);

  if (!segments) return <div className="text-[var(--text-muted)] text-sm">Loading...</div>;

  const allSegs: any[] = segments.segments || [];
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

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {(["all", "context"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2 py-0.5 text-xs rounded ${
                filter === f ? "bg-[var(--bg-surface)] text-[var(--text)]" : "text-[var(--text-muted)]"
              }`}
            >
              {f === "all" ? "All" : "Context"}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => { setRebuilding(true); api.rebuildSegments(agentName, token).finally(() => { setRebuilding(false); load(); }); }}
            className="px-2 py-0.5 text-xs rounded text-[var(--text-muted)] hover:text-[var(--text)] border border-[var(--border)]"
            disabled={rebuilding}
          >
            {rebuilding ? "Rebuilding..." : "Rebuild"}
          </button>
        </div>
      </div>

      {/* Segment blocks by level */}
      {sortedLevels.map((level) => (
        <div key={level}>
          <div className="text-xs text-[var(--text-muted)] mb-1">L{level} · {levels.get(level)!.length} segments</div>
          <div className="flex flex-wrap gap-1">
            {levels.get(level)!.map((s: any) => {
              const tokens = s.token_count || 0;
              const isContext = contextIds.has(s.id);
              return (
                <button
                  key={s.id}
                  onClick={() => setSelected(s)}
                  className={`rounded transition-colors border text-[10px] leading-tight ${
                    selected?.id === s.id
                      ? "border-[var(--accent)] bg-[var(--accent)]/20"
                      : isContext
                        ? "border-[var(--accent)]/40 bg-[var(--accent)]/10"
                        : "border-[var(--border)] bg-[var(--bg-surface)] hover:border-[var(--text-muted)]"
                  }`}
                  style={{
                    width: Math.max(28, Math.min(80, Math.sqrt(tokens) * 0.8)),
                    height: 28,
                  }}
                  title={`${s.msg_start}–${s.msg_end} · ${tokens} tokens`}
                />
              );
            })}
          </div>
        </div>
      ))}

      {/* Detail panel */}
      {selected && (
        <div className="mt-3 p-3 rounded border border-[var(--border)] bg-[var(--bg-surface)]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-[var(--text-muted)]">
              L{selected.level} · msgs {selected.msg_start}–{selected.msg_end} · {selected.token_count} tokens
              {selected.summary_token_count && ` → ${selected.summary_token_count} summary tokens`}
            </span>
            <button
              onClick={() => api.resummarizeSegment(agentName, token, selected.id).then(load)}
              className="px-2 py-0.5 text-[10px] rounded border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]"
            >
              Resummarize
            </button>
          </div>
          {selected.start_time && (
            <div className="text-[10px] text-[var(--text-muted)] mb-2">
              {new Date(selected.start_time).toLocaleString()} — {selected.end_time ? new Date(selected.end_time).toLocaleString() : "now"}
            </div>
          )}
          {selected.summary ? (
            <div
              className="text-xs text-[var(--text)] markdown-body"
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

  const load = useCallback(() => {
    api.getSummaries(agentName, token).then((d) => setSummaries(d.summaries || [])).catch(() => {});
  }, [agentName, token]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--text-muted)]">{summaries?.length ?? 0} summaries</span>
        <button
          onClick={() => { setRegenerating(true); api.regenerateSummary(agentName, token).finally(() => { setRegenerating(false); load(); }); }}
          className="px-2 py-0.5 text-xs rounded border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]"
          disabled={regenerating}
        >
          {regenerating ? "Regenerating..." : "Regenerate"}
        </button>
      </div>
      {summaries?.map((s: any, i: number) => (
        <div key={i} className="p-3 rounded border border-[var(--border)] bg-[var(--bg-surface)]">
          <div className="text-xs text-[var(--text-muted)] mb-1">{s.source_key || s.type}</div>
          <div
            className="text-xs text-[var(--text)] markdown-body"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(s.content || "") }}
          />
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
    api.getRecallStats(agentName, token).then(setStats).catch(() => {});
  }, [agentName, token]);

  const search = () => {
    if (!query.trim()) return;
    setSearching(true);
    api.recallSearch(agentName, token, query).then((d) => setResults(d.results || [])).finally(() => setSearching(false));
  };

  return (
    <div className="space-y-3">
      {/* Stats */}
      {stats && (
        <div className="flex gap-4 text-xs text-[var(--text-muted)]">
          <span>{stats.messages ?? 0} messages</span>
          <span>{stats.chunks ?? 0} chunks</span>
          <span>{stats.sessions ?? 0} sessions</span>
        </div>
      )}

      {/* Search */}
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="Search past conversations..."
          className="flex-1 px-3 py-1.5 text-sm rounded border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)]"
        />
        <button
          onClick={search}
          disabled={searching}
          className="px-3 py-1.5 text-xs rounded bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          {searching ? "..." : "Search"}
        </button>
      </div>

      {/* Results */}
      {results?.map((r: any, i: number) => (
        <div key={i} className="p-3 rounded border border-[var(--border)] bg-[var(--bg-surface)]">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-[var(--text-muted)]">
              distance: {r.distance?.toFixed(3)}
            </span>
            <span className="text-[10px] text-[var(--text-muted)]">
              msgs {r.msg_start}–{r.msg_end}
            </span>
          </div>
          <div className="text-xs text-[var(--text)] whitespace-pre-wrap">{r.text?.slice(0, 500)}</div>
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
    api.getSystemPrompt(agentName, token).then(setPrompt).catch(() => {});
  }, [agentName, token]);

  if (prompt === null) return <div className="text-[var(--text-muted)] text-sm">Loading...</div>;

  if (view === "raw") {
    return (
      <div>
        <div className="flex gap-1 mb-3">
          <ViewToggle view={view} setView={setView} />
        </div>
        <pre className="text-xs text-[var(--text)] whitespace-pre-wrap break-words bg-[var(--bg-surface)] p-3 rounded border border-[var(--border)] max-h-[60vh] overflow-y-auto">
          {prompt}
        </pre>
      </div>
    );
  }

  // Parse XML-like sections from system prompt
  const sections = parsePromptSections(prompt);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-[var(--text-muted)]">
          ~{Math.round(prompt.length / 3.3)} tokens
        </span>
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
    <div className="flex gap-1">
      {(["structured", "raw"] as const).map((v) => (
        <button
          key={v}
          onClick={() => setView(v)}
          className={`px-2 py-0.5 text-xs rounded ${
            view === v ? "bg-[var(--bg-surface)] text-[var(--text)]" : "text-[var(--text-muted)]"
          }`}
        >
          {v}
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
    // Capture text before this tag
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
  // Trailing text
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

  return (
    <div className="rounded border border-[var(--border)] bg-[var(--bg-surface)]">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 text-left"
      >
        <span className="text-xs text-[var(--text)]">{label}</span>
        <span className="text-[10px] text-[var(--text-muted)]">~{tokens} tokens</span>
      </button>
      {open && (
        <div className="px-3 pb-3 border-t border-[var(--border)]">
          <div
            className="text-xs text-[var(--text)] markdown-body mt-2"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(section.content) }}
          />
        </div>
      )}
    </div>
  );
}
