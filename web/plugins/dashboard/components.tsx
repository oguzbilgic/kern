"use client";

import { useState, useRef, useEffect } from "react";
import type { ChatMessage } from "../../lib/types";
import { getDashboardStore as getDashboardStoreFromImport } from "./useDashboards";

// --- Helpers to read plugin data from ChatMessage ---

export function getDashboardData(msg: ChatMessage) {
  const d = msg.pluginData || {};
  return {
    html: String(d.html || ""),
    target: String(d.target || "inline"),
    title: String(d.title || "Render"),
    dashboard: d.dashboard as string | null | undefined,
  };
}

// --- Icons ---

const DashIcon = ({ size = 14, className = "" }: { size?: number; className?: string }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className={className}>
    <rect x="1" y="1" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
    <rect x="9" y="1" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
    <rect x="1" y="9" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
    <rect x="9" y="9" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

const PanelIcon = () => (
  <svg width={12} height={12} viewBox="0 0 16 16" fill="none">
    <rect x="1" y="1" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
    <line x1="10" y1="1" x2="10" y2="15" stroke="currentColor" strokeWidth="1.5" />
  </svg>
);

/** Inline render block — full iframe in chat */
export function RenderBlock({ msg, onOpenPanel }: { msg: ChatMessage; onOpenPanel?: (html: string, title: string) => void }) {
  const [showSource, setShowSource] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(200);

  const { html, title } = getDashboardData(msg);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "kern-render-height" && iframeRef.current) {
        const h = Math.min(Math.max(e.data.height || 200, 60), 800);
        if (Math.abs(h - height) > 2) setHeight(h);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [height]);

  const wrappedHtml = wrapHtml(html);

  return (
    <div className="my-2 max-w-[90%]">
      <div className="flex items-center justify-between px-3 py-1.5 rounded-t-lg text-xs"
        style={{ background: "var(--bg-surface)", borderBottom: "1px solid var(--border)" }}>
        <span className="flex items-center gap-1.5 text-[var(--text-muted)]">
          <DashIcon size={12} />
          {title}
        </span>
        <div className="flex gap-2">
          <button onClick={() => setShowSource(!showSource)}
            className="text-[var(--text-muted)] hover:text-[var(--text-dim)] transition-colors cursor-pointer"
            title={showSource ? "Show render" : "Show source"}>
            {showSource ? "▶" : "{ }"}
          </button>
          {onOpenPanel && (
            <button onClick={() => onOpenPanel(html, title)}
              className="text-[var(--text-muted)] hover:text-[var(--text-dim)] transition-colors cursor-pointer"
              title="Open in panel">
              <PanelIcon />
            </button>
          )}
        </div>
      </div>
      {showSource ? (
        <pre className="px-3 py-2 text-xs overflow-auto rounded-b-lg font-mono"
          style={{ background: "#161616", color: "var(--text-dim)", maxHeight: 400 }}>{html}</pre>
      ) : (
        <iframe ref={iframeRef} srcDoc={wrappedHtml} sandbox="allow-scripts"
          className="w-full border-0 rounded-b-lg" style={{ height, background: "transparent" }} />
      )}
    </div>
  );
}

/** Panel-target card — small clickable button in chat that opens panel */
export function RenderCard({ msg, onOpenPanel }: { msg: ChatMessage; onOpenPanel?: (html: string, title: string) => void }) {
  const { html, title } = getDashboardData(msg);

  return (
    <button
      onClick={() => onOpenPanel?.(html, title)}
      className="my-2 flex items-center gap-2.5 px-4 py-2.5 rounded-lg text-xs cursor-pointer transition-all hover:brightness-110 active:scale-[0.98]"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
      title="Open in panel"
    >
      <DashIcon size={14} className="text-[var(--text-muted)]" />
      <span className="text-[var(--text-dim)] font-medium">{title}</span>
      <PanelIcon />
    </button>
  );
}

/** Pure iframe content for panel surface — no chrome, just the rendered HTML */
export function DashboardIframe({ html }: { html: string }) {
  const wrappedHtml = wrapHtml(html);
  return (
    <iframe
      srcDoc={wrappedHtml}
      sandbox="allow-scripts"
      className="w-full h-full border-0"
      style={{ background: "transparent" }}
    />
  );
}

/** Dashboard header button with dropdown */
export function DashboardButton({ agentName, token, baseUrl, onOpenDashboard }: {
  agentName?: string;
  token?: string;
  baseUrl?: string;
  onOpenDashboard: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [dashboards, setDashboards] = useState<string[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !baseUrl) return;
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    fetch(`${baseUrl}/dashboards`, { headers })
      .then(r => r.json())
      .then(d => setDashboards(d.dashboards || []))
      .catch(() => setDashboards([]));
  }, [open, baseUrl, token]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="px-1.5 py-1 text-sm rounded text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-surface)] transition-colors leading-none cursor-pointer"
        title="Dashboards"
      >
        <DashIcon size={14} />
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 rounded-lg shadow-lg overflow-hidden z-50 min-w-[180px]"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
        >
          {dashboards.length === 0 ? (
            <div className="px-3 py-2 text-xs text-[var(--text-muted)]">No dashboards</div>
          ) : (
            dashboards.map(d => (
              <button
                key={d}
                onClick={() => { onOpenDashboard(d); setOpen(false); }}
                className="w-full text-left px-3 py-2 text-xs hover:bg-[var(--bg-hover)] transition-colors cursor-pointer flex items-center gap-2"
              >
                <DashIcon size={12} className="text-[var(--text-muted)]" />
                <span className="text-[var(--text-dim)]">{d}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/** Sidebar section showing dashboards from all agents */
export function DashboardSidebar({ agents, mini }: { agents: { name: string; running: boolean; baseUrl: string; token: string }[]; activeAgent: string | null; mini: boolean }) {
  const store = getDashboardStoreFromImport();
  const dashboards = store?.allDashboards || [];
  const activeDashboard = store?.activeDashboard || null;

  if (!dashboards.length) return null;

  return (
    <>
      <div className="mt-2" />
      {!mini && (
        <div className="px-4 mb-1">
          <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-semibold">Dashboards</span>
        </div>
      )}
      {dashboards.map((d: { name: string; baseUrl: string }) => {
        const isActive = activeDashboard === d.name;
        const agent = agents.find(a => a.baseUrl === d.baseUrl);
        return (
          <button
            key={`${d.baseUrl}-${d.name}`}
            onClick={() => {
              if (isActive) {
                store?.closePanel();
              } else if (agent) {
                store?.loadAndOpen(d.name, agent.baseUrl, agent.token || "");
              }
            }}
            className={`flex items-center w-full text-left transition-colors cursor-pointer rounded-lg overflow-hidden p-2.5 ${
              mini ? "justify-center" : "gap-2"
            } ${isActive ? "bg-white/[0.08]" : "hover:bg-white/[0.05]"}`}
            title={mini ? `${d.name}${agent ? ` (${agent.name})` : ""}` : d.name}
          >
            <span
              className="flex-shrink-0 w-2 h-2"
              style={{
                transform: "rotate(45deg)",
                background: isActive ? "var(--accent)" : "var(--text-muted)",
                opacity: isActive ? 1 : 0.5,
              }}
            />
            {!mini && (
              <>
                <span className={`text-xs truncate ${isActive ? "text-[var(--text)]" : "text-[var(--text-muted)]"}`}>
                  {d.name}
                </span>
                <span className="text-[10px] text-[var(--text-muted)] ml-auto opacity-50 flex-shrink-0">
                  {agent?.name}
                </span>
              </>
            )}
          </button>
        );
      })}
    </>
  );
}

function wrapHtml(html: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{box-sizing:border-box}body{margin:0;padding:0;background:transparent;color:#e0e0e0;font-family:-apple-system,sans-serif}</style>
</head><body>${html}
<script>
  const ro = new ResizeObserver(() => {
    parent.postMessage({ type: 'kern-render-height', height: document.body.scrollHeight }, '*');
  });
  ro.observe(document.body);
</script></body></html>`;
}
