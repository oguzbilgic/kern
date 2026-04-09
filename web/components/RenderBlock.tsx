"use client";

import { useState, useRef, useEffect } from "react";
import type { ChatMessage } from "../lib/types";

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
        <span className="text-[var(--text-muted)]">
          {msg.renderDashboard ? `📊 ${title}` : `✦ ${title}`}
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
              title="Open in panel">⧉</button>
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
  const icon = msg.renderDashboard ? "📊" : "✦";

  return (
    <button
      onClick={() => onOpenPanel?.(msg.renderHtml || "", title)}
      className="my-2 flex items-center gap-2.5 px-4 py-2.5 rounded-lg text-xs cursor-pointer transition-all hover:brightness-110 active:scale-[0.98]"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
      title="Open in panel"
    >
      <span className="text-base">{icon}</span>
      <span className="text-[var(--text-dim)] font-medium">{title}</span>
      <span className="text-[var(--text-muted)] ml-1">⧉</span>
    </button>
  );
}

/** Resizable side panel for rendered content */
export function RenderPanel({ html, title, onClose }: { html: string; title: string; onClose: () => void }) {
  const [width, setWidth] = useState(480);
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
        <span className="text-sm font-semibold truncate">{title}</span>
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
