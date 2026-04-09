"use client";

import { useState, useRef, useEffect } from "react";
import type { ChatMessage } from "../../lib/types";

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

  const html = msg.renderHtml || "";
  const title = msg.renderTitle || "Render";

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
  const title = msg.renderTitle || "Render";

  return (
    <button
      onClick={() => onOpenPanel?.(msg.renderHtml || "", title)}
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

/** Dashboard header button with dropdown */
export function DashboardButton({ agentName, token, serverUrl, onOpenDashboard }: {
  agentName?: string;
  token?: string;
  serverUrl?: string;
  onOpenDashboard: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [dashboards, setDashboards] = useState<string[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !agentName) return;
    const base = serverUrl || "";
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    fetch(`${base}/api/agents/${agentName}/dashboards`, { headers })
      .then(r => r.json())
      .then(d => setDashboards(d.dashboards || []))
      .catch(() => setDashboards([]));
  }, [open, agentName, token, serverUrl]);

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

/** Resizable side panel for rendered content */
export function RenderPanel({ html, title, dashboards, activeDashboard, onSwitchDashboard, onClose }: {
  html: string;
  title: string;
  dashboards?: string[];
  activeDashboard?: string;
  onSwitchDashboard?: (name: string) => void;
  onClose: () => void;
}) {
  const [width, setWidth] = useState(() => {
    // Try to give panel ~50% of available space, min 480, max 800
    if (typeof window !== "undefined") {
      const available = window.innerWidth - 400; // reserve ~400px for sidebar + chat
      return Math.max(480, Math.min(Math.floor(available * 0.55), 800));
    }
    return 480;
  });
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = startX.current - e.clientX;
      setWidth(Math.max(280, Math.min(startW.current + delta, 800)));
    };
    const onUp = () => { dragging.current = false; document.body.style.cursor = ""; document.body.style.userSelect = ""; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, []);

  const onDragStart = (e: React.MouseEvent) => {
    dragging.current = true;
    startX.current = e.clientX;
    startW.current = width;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const wrappedHtml = wrapHtml(html);

  return (
    <div className="flex flex-col flex-shrink-0 relative" style={{ width }}>
      {/* Resize handle */}
      <div
        onMouseDown={onDragStart}
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-[var(--accent)] transition-colors z-10"
        style={{ background: "var(--border)" }}
      />
      {/* Header */}
      <div className="h-12 border-b border-[var(--border)] flex items-center justify-between px-4 flex-shrink-0 ml-1">
        <div className="flex items-center gap-2 min-w-0">
          <DashIcon size={13} className="text-[var(--text-muted)] flex-shrink-0" />
          {dashboards && dashboards.length > 1 && onSwitchDashboard ? (
            <select
              value={activeDashboard || ""}
              onChange={e => onSwitchDashboard(e.target.value)}
              className="text-sm font-semibold bg-transparent border-none outline-none cursor-pointer truncate text-[var(--text)]"
              style={{ appearance: "auto" }}
            >
              {dashboards.map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          ) : (
            <span className="text-sm font-semibold truncate">{title}</span>
          )}
        </div>
        <button onClick={onClose}
          className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors cursor-pointer text-base leading-none ml-2">✕</button>
      </div>
      {/* Content */}
      <iframe
        srcDoc={wrappedHtml}
        sandbox="allow-scripts"
        className="flex-1 w-full border-0 ml-1"
        style={{ background: "transparent" }}
      />
    </div>
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
