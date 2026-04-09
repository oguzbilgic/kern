"use client";

import { useState, useRef, useEffect } from "react";
import type { ChatMessage } from "../lib/types";

export function RenderBlock({ msg }: { msg: ChatMessage }) {
  const [showSource, setShowSource] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(200);

  const html = msg.renderHtml || "";
  const title = msg.renderTitle || "Render";

  // Auto-resize iframe based on content
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

  // Wrap HTML with auto-height reporting script
  const wrappedHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{box-sizing:border-box}body{margin:0;padding:0;background:transparent;color:#e0e0e0;font-family:-apple-system,sans-serif}</style>
</head><body>${html}
<script>
  const ro = new ResizeObserver(() => {
    parent.postMessage({ type: 'kern-render-height', height: document.body.scrollHeight }, '*');
  });
  ro.observe(document.body);
</script></body></html>`;

  return (
    <div className="my-2 max-w-[90%]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 rounded-t-lg text-xs"
        style={{ background: "var(--bg-surface)", borderBottom: "1px solid var(--border)" }}>
        <span className="text-[var(--text-muted)]">
          {msg.renderDashboard ? `📊 ${title}` : `✦ ${title}`}
        </span>
        <div className="flex gap-2">
          <button
            onClick={() => setShowSource(!showSource)}
            className="text-[var(--text-muted)] hover:text-[var(--text-dim)] transition-colors"
            title={showSource ? "Show render" : "Show source"}>
            {showSource ? "▶" : "{ }"}
          </button>
          <button
            onClick={() => setFullscreen(!fullscreen)}
            className="text-[var(--text-muted)] hover:text-[var(--text-dim)] transition-colors"
            title={fullscreen ? "Exit fullscreen" : "Fullscreen"}>
            {fullscreen ? "✕" : "⛶"}
          </button>
        </div>
      </div>

      {/* Content */}
      {showSource ? (
        <pre className="px-3 py-2 text-xs overflow-auto rounded-b-lg font-mono"
          style={{ background: "#161616", color: "var(--text-dim)", maxHeight: 400 }}>
          {html}
        </pre>
      ) : (
        <iframe
          ref={iframeRef}
          srcDoc={wrappedHtml}
          sandbox="allow-scripts"
          className={`w-full border-0 rounded-b-lg ${fullscreen ? "fixed inset-0 z-50 rounded-none" : ""}`}
          style={{
            height: fullscreen ? "100vh" : height,
            background: "transparent",
          }}
        />
      )}

      {/* Fullscreen backdrop */}
      {fullscreen && (
        <div className="fixed inset-0 z-40 bg-black/80" onClick={() => setFullscreen(false)} />
      )}
    </div>
  );
}
