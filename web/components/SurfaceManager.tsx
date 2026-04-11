"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { getSurfaces, getSurfaceGroups, getSurfacesByGroup, onSurfaceChange, type Surface } from "../lib/surfaces";
import { useStore } from "../lib/store";

const accent = "#e5b567";

interface SurfaceManagerProps {
  /** Which surface to open initially (or null = closed) */
  openSurface: string | null;
  onClose: () => void;
  onActiveSurface?: (id: string | null) => void;
}

/**
 * SurfaceManager — owns all chrome for displaying surfaces.
 * Surfaces in "modal" group render as a tabbed modal overlay.
 * Surfaces in "panel" group render as a resizable side panel.
 * 
 * The surface itself only provides content via render(). All chrome
 * (tabs, close button, resize handle, backdrop) lives here.
 */
export function SurfaceModal({ openSurface, onClose, onActiveSurface }: SurfaceManagerProps) {
  const [surfaces, setSurfaces] = useState<Surface[]>([]);
  const [activeId, setActiveId] = useState<string | null>(openSurface);

  // Listen for surface registry changes
  useEffect(() => {
    const update = () => setSurfaces(getSurfaces().filter(s => s.mode === "modal"));
    update();
    return onSurfaceChange(update);
  }, []);

  // Sync with external open request
  useEffect(() => {
    if (openSurface) setActiveId(openSurface);
  }, [openSurface]);

  useEffect(() => {
    onActiveSurface?.(activeId);
  }, [activeId, onActiveSurface]);

  if (!openSurface || surfaces.length === 0) return null;

  const active = surfaces.find(s => s.id === activeId) || surfaces[0];
  const groups = getSurfaceGroups().filter(g => getSurfacesByGroup(g).some(s => s.mode === "modal"));

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
            <h2 style={{ color: "var(--text)", fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
              {active?.label || "Memory"}
            </h2>
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
          {groups.map(group => {
            const groupSurfaces = getSurfacesByGroup(group).filter(s => s.mode === "modal");
            return groupSurfaces.map(s => (
              <button
                key={s.id}
                onClick={() => setActiveId(s.id)}
                style={{
                  background: "none",
                  border: "none",
                  borderBottom: `2px solid ${active?.id === s.id ? accent : "transparent"}`,
                  color: active?.id === s.id ? "var(--text)" : "var(--text-muted)",
                  fontSize: 13,
                  fontWeight: 500,
                  padding: "9px 14px",
                  cursor: "pointer",
                  transition: "color 0.15s, border-color 0.15s",
                }}
              >
                {s.label}
              </button>
            ));
          })}
        </div>

        {/* Content — rendered by the surface, no chrome leaks */}
        <div style={{ flex: 1, overflow: "auto", padding: 20 }}>
          {active?.render()}
        </div>
      </div>
    </div>
  );
}

/**
 * SurfacePanel — resizable side panel for "panel" mode surfaces.
 * Owns all chrome: resize handle, title, tab switching, close button.
 */
export function SurfacePanel() {
  const [surfaces, setSurfaces] = useState<Surface[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [width, setWidth] = useState(() => {
    if (typeof window !== "undefined") {
      const available = window.innerWidth - 400;
      return Math.max(480, Math.min(Math.floor(available * 0.55), window.innerWidth - 360));
    }
    return 480;
  });
  const [isDragging, setIsDragging] = useState(false);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);

  useEffect(() => {
    const update = () => {
      const panelSurfaces = getSurfaces().filter(s => s.mode === "panel");
      setSurfaces(panelSurfaces);
      // Auto-select first if current selection is gone
      setActiveId(prev => {
        if (prev && panelSurfaces.find(s => s.id === prev)) return prev;
        return panelSurfaces[0]?.id ?? null;
      });
    };
    update();
    return onSurfaceChange(update);
  }, []);

  useEffect(() => {
    const getMaxWidth = () => {
      const sidebarEl = document.querySelector('[data-sidebar]') as HTMLElement | null;
      const sidebarW = sidebarEl?.offsetWidth ?? 0;
      return window.innerWidth - sidebarW - 360;
    };
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = startX.current - e.clientX;
      setWidth(Math.max(280, Math.min(startW.current + delta, getMaxWidth())));
    };
    const onUp = () => {
      dragging.current = false;
      setIsDragging(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    const onResize = () => {
      const maxW = getMaxWidth();
      if (maxW < 280) {
        // Try collapsing sidebar to mini first
        const { ui, setSidebarMini } = useStore.getState();
        if (!ui.sidebarMini) {
          setSidebarMini(true);
          // Recheck after sidebar collapses (200→75 = +125px)
          requestAnimationFrame(() => {
            const newMaxW = getMaxWidth();
            if (newMaxW < 280) {
              const panelSurfaces = getSurfaces().filter(s => s.mode === "panel");
              panelSurfaces.forEach(s => s.onClose?.());
            } else {
              setWidth(prev => Math.max(280, Math.min(prev, newMaxW)));
            }
          });
          return;
        }
        // Already mini — close panel
        const panelSurfaces = getSurfaces().filter(s => s.mode === "panel");
        panelSurfaces.forEach(s => s.onClose?.());
        return;
      }
      setWidth(prev => Math.max(280, Math.min(prev, maxW)));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    dragging.current = true;
    setIsDragging(true);
    startX.current = e.clientX;
    startW.current = width;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [width]);

  if (surfaces.length === 0) return null;

  const active = surfaces.find(s => s.id === activeId) || surfaces[0];

  return (
    <div className="flex flex-col flex-shrink-0 relative" style={{ width }}>
      {/* Drag overlay — blocks iframe from stealing mouse events */}
      {isDragging && <div className="absolute inset-0 z-20" />}
      {/* Resize handle — wide invisible hit area with thin visible line */}
      <div
        onMouseDown={onDragStart}
        className="absolute left-0 top-0 bottom-0 cursor-col-resize z-10 flex items-stretch"
        style={{ width: 12, marginLeft: -6 }}
      >
        <div className="w-px mx-auto hover:w-0.5 transition-all" style={{ background: "var(--border)" }} />
      </div>

      {/* Header with tabs */}
      <div className="h-12 border-b border-[var(--border)] flex items-center justify-between px-4 flex-shrink-0 ml-1">
        <div className="flex items-center gap-1 min-w-0">
          {surfaces.length > 1 ? (
            surfaces.map(s => (
              <button
                key={s.id}
                onClick={() => setActiveId(s.id)}
                className="text-xs px-2 py-1 rounded cursor-pointer transition-colors"
                style={{
                  background: active?.id === s.id ? "rgba(255,255,255,0.08)" : "transparent",
                  color: active?.id === s.id ? "var(--text)" : "var(--text-muted)",
                }}
              >
                {s.label}
              </button>
            ))
          ) : (
            <span className="text-sm font-semibold truncate">{active?.label}</span>
          )}
        </div>
        <button
          onClick={() => active?.onClose?.()}
          className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors cursor-pointer text-lg leading-none ml-2 p-1"
        >
          ×
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto ml-1">
        {active?.render()}
      </div>
    </div>
  );
}

/** Get the minimum chat width when panel surfaces are active */
export function panelMinChatWidth(): number {
  return 360;
}
