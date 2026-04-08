"use client";

import { useState, useEffect } from "react";
import * as api from "../../lib/api";
import { TabProps, accent, StatCard, ActionBtn, EmptyState } from "./shared";

export function RecallTab({ agentName, token, serverUrl }: TabProps) {
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
