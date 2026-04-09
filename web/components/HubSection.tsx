"use client";

import { useState, useEffect, useCallback } from "react";
import { getHubStatus, getHubAgents, getHubStats, type HubStatus, type HubAgent, type HubStats } from "../lib/api";

interface HubSectionProps {
  token: string | null;
  serverUrl?: string;
  mini: boolean;
  /** Agent names running on this server — to mark which hub agents are local */
  localAgentNames?: string[];
}

export function HubSection({ token, serverUrl, mini, localAgentNames = [] }: HubSectionProps) {
  const [status, setStatus] = useState<HubStatus | null>(null);
  const [agents, setAgents] = useState<HubAgent[]>([]);
  const [stats, setStats] = useState<HubStats | null>(null);
  const [showModal, setShowModal] = useState(false);

  const refresh = useCallback(async () => {
    const s = await getHubStatus(token, serverUrl);
    setStatus(s);
    if (s?.running) {
      const [a, st] = await Promise.all([
        getHubAgents(token, serverUrl),
        getHubStats(token, serverUrl),
      ]);
      setAgents(a);
      setStats(st);
    } else {
      setAgents([]);
      setStats(null);
    }
  }, [token, serverUrl]);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 30000);
    return () => clearInterval(iv);
  }, [refresh]);

  // Don't render if hub isn't configured
  if (!status?.configured && !status?.running) return null;

  const online = agents.filter(a => a.online).length;
  const isRunning = status?.running;

  return (
    <>
      {/* Divider */}
      <div className="mx-2 my-2 border-t border-[var(--border)]" />

      {/* Hub row */}
      <button
        onClick={() => setShowModal(true)}
        className="flex items-center gap-2.5 w-full rounded-lg text-sm text-left transition-colors cursor-pointer p-2.5 mb-0.5 overflow-hidden hover:bg-white/[0.05]"
        title={mini ? `Hub — ${isRunning ? `${online} online` : "offline"}` : undefined}
      >
        <div className="relative flex-shrink-0">
          <div
            className={`w-10 h-10 flex items-center justify-center text-[16px] ${!isRunning ? "opacity-40" : ""}`}
            style={{ borderRadius: "22%", backgroundColor: "var(--bg-surface)" }}
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
              <path d="M10 2L18 10L10 18L2 10Z" fill={isRunning ? "var(--accent)" : "var(--text-muted)"} opacity={isRunning ? 1 : 0.5} />
            </svg>
          </div>
          {isRunning && online > 0 && (
            <span className="absolute flex items-center justify-center rounded-full border-2 border-[var(--bg-sidebar)] w-[18px] h-[18px] -bottom-[3px] -right-[3px] bg-[var(--accent)] text-[10px] font-bold text-[var(--bg)]">
              {online}
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <span className="truncate whitespace-nowrap text-[var(--text-muted)]">Hub</span>
        </div>
      </button>

      {/* Hub info modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowModal(false)}>
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg p-4 w-96 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-semibold flex items-center gap-2">
                <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
                  <path d="M10 2L18 10L10 18L2 10Z" fill={isRunning ? "var(--accent)" : "var(--text-muted)"} />
                </svg>
                Hub
              </div>
              <button onClick={() => setShowModal(false)} className="text-[var(--text-muted)] hover:text-[var(--text)] text-lg cursor-pointer">×</button>
            </div>

            {/* Status */}
            <div className="text-xs text-[var(--text-muted)] mb-3 space-y-1">
              <div>Status: <span className={isRunning ? "text-green-400" : "text-red-400"}>{isRunning ? "running" : "offline"}</span></div>
              {stats && (
                <>
                  <div>Agents: {stats.agents.registered} registered, {stats.agents.online} online</div>
                  <div>Messages relayed: {stats.messages.toLocaleString()}</div>
                  <div>Uptime: {formatUptime(stats.uptime)}</div>
                </>
              )}
            </div>

            {/* Agent list */}
            {agents.length > 0 && (
              <div>
                <div className="text-[10px] uppercase text-[var(--text-muted)] tracking-wider mb-1.5">Agents</div>
                <div className="space-y-1">
                  {agents.map(a => {
                    const isLocal = localAgentNames.includes(a.name);
                    return (
                      <div key={a.id} className="flex items-center gap-2 text-xs py-1 px-2 rounded bg-white/[0.03]">
                        <span className={`w-2 h-2 rounded-full ${a.online ? "bg-green-400" : "bg-[var(--text-muted)]"}`} />
                        <span className="flex-1 truncate">
                          {a.name}
                          {isLocal && <span className="text-[var(--text-muted)] ml-1">(local)</span>}
                        </span>
                        <span className="text-[var(--text-muted)] font-mono text-[10px]">{a.id}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function formatUptime(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
