"use client";

import { useState, useEffect } from "react";
import * as api from "../../lib/api";
import { TabProps, accent, EmptyState } from "./shared";

function formatDuration(start: string, end: string) {
  if (!start) return "—";
  const ms = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime();
  const days = Math.floor(ms / 86400000);
  if (days > 1) return `${days} days`;
  const hrs = Math.floor(ms / 3600000);
  if (hrs > 0) return `${hrs}h`;
  return `${Math.floor(ms / 60000)}m`;
}

function ActivityChart({ data, color, label }: { data: { key: string; count: number }[]; color: string; label: string }) {
  if (!data?.length) return null;
  const max = Math.max(...data.map(d => d.count), 1);
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase" as const, letterSpacing: 0.5, marginBottom: 4 }}>
        {label}
      </div>
      <div style={{
        display: "flex", alignItems: "flex-end", gap: 2, height: 64,
        background: "rgba(0,0,0,0.15)", borderRadius: 6, padding: 8,
      }}>
        {data.map((d, i) => (
          <div key={i} style={{
            flex: 1, background: color, opacity: 0.5, borderRadius: "2px 2px 0 0",
            height: `${(d.count / max) * 100}%`, minHeight: d.count > 0 ? 2 : 0,
          }} title={`${d.key}: ${d.count}`} />
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text-muted)", marginTop: 2 }}>
        <span>{data[0].key}</span>
        <span>{data[data.length - 1].key}</span>
      </div>
    </div>
  );
}

export function SessionsTab({ baseUrl, token }: TabProps) {
  const [data, setData] = useState<{ sessions: any[]; currentSessionId: string | null } | null>(null);
  const [activity, setActivity] = useState<any>(null);
  const [activeSession, setActiveSession] = useState<string | null>(null);

  useEffect(() => {
    api.getSessions(baseUrl, token).then((d) => {
      if (d?.sessions) {
        setData(d);
        setActiveSession(d.currentSessionId || d.sessions?.[0]?.session_id || null);
      } else {
        setData({ sessions: [], currentSessionId: null });
      }
    }).catch(() => setData({ sessions: [], currentSessionId: null }));
  }, [baseUrl, token]);

  useEffect(() => {
    if (activeSession) {
      api.getSessionActivity(baseUrl, token, activeSession).then(setActivity).catch(() => {});
    }
  }, [baseUrl, token, activeSession]);

  if (!data) return <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading...</div>;
  if (!data.sessions.length) return <EmptyState text="No session data available" />;

  return (
    <div>
      {data.sessions.map((s: any) => {
        const isLive = s.session_id === data.currentSessionId;
        const isActive = activeSession === s.session_id;
        const roles = s.roles || {};
        const duration = formatDuration(s.first_ts, s.last_ts);
        return (
          <div
            key={s.session_id}
            onClick={() => setActiveSession(s.session_id)}
            style={{
              background: isActive ? "var(--bg-sidebar)" : "rgba(255,255,255,0.02)",
              border: `1px ${isActive ? "solid" : "dashed"} ${isActive ? "rgba(229, 181, 103, 0.35)" : "var(--border)"}`,
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
                {s.first_ts ? new Date(s.first_ts).toLocaleDateString() : "?"} — {s.last_ts ? new Date(s.last_ts).toLocaleDateString() : "now"}
              </span>
            </div>

            {/* Stats row */}
            <div style={{
              display: "flex", gap: isActive ? 16 : 12, flexWrap: "wrap",
              marginTop: isActive ? 8 : 0,
            }}>
              {[
                { label: "Messages", value: s.messages?.toLocaleString() ?? "?" },
                { label: "Duration", value: duration },
                ...(isActive ? [
                  { label: "User", value: (roles.user || 0).toLocaleString() },
                  { label: "Assistant", value: (roles.assistant || 0).toLocaleString() },
                  { label: "Tool", value: (roles.tool || 0).toLocaleString() },
                ] : []),
              ].map((stat, i) => (
                <div key={i} style={{ textAlign: "center" as const }}>
                  <div style={{ fontSize: isActive ? 16 : 13, fontWeight: 600, color: "var(--text)", fontFamily: "var(--font-mono)" }}>
                    {stat.value}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase" as const, letterSpacing: 0.3 }}>
                    {stat.label}
                  </div>
                </div>
              ))}
            </div>

            {/* Activity charts for active session */}
            {isActive && activity?.daily?.length > 0 && (
              <ActivityChart
                data={activity.daily.map((d: any) => ({ key: d.date, count: d.count }))}
                color={accent}
                label="Daily activity"
              />
            )}
            {isActive && activity?.hourly?.length > 0 && (() => {
              const hourMap = Object.fromEntries(activity.hourly.map((h: any) => [h.hour, h.count]));
              const full24 = Array.from({ length: 24 }, (_, i) => ({
                key: `${String(i).padStart(2, "0")}:00`,
                count: hourMap[i] || 0,
              }));
              return <ActivityChart data={full24} color="#8b5cf6" label="Hourly distribution (UTC)" />;
            })()}
          </div>
        );
      })}
    </div>
  );
}
