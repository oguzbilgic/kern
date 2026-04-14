"use client";

import { useState, useCallback, useEffect, useMemo, type DragEvent } from "react";
import { useAgents, agentKey } from "../hooks/useAgents";
import { useAgent } from "../hooks/useAgent";
import { Sidebar } from "../components/Sidebar";
import { Chat } from "../components/Chat";
import { Input, fileToAttachment } from "../components/Input";
import { InfoPanel, PinnedStats } from "../components/InfoPanel";
import { ThemePicker } from "../components/ThemePicker";
import { ThinkingDots } from "../components/ThinkingDots";
import { SurfaceModal, SurfacePanel, panelMinChatWidth } from "../components/SurfaceManager";
import { useSurfaces } from "../lib/surfaces";
import { useMemorySurfaces, MEMORY_SURFACE_ID } from "../components/inspector";
import { renderPluginHeaders } from "../plugins/registry";
import { usePluginInit } from "../plugins";
import { useStore } from "../lib/store";
import type { Attachment } from "../lib/types";

export default function Home() {
  const { agents, activeAgent, active, setActive, addServer, removeServer, addDirectAgent, removeDirectAgent, reorder } = useAgents();
  const [dragOver, setDragOver] = useState(false);
  const [externalAttachments, setExternalAttachments] = useState<Attachment[]>([]);
  const prefs = useStore((s) => s.prefs);
  const setPrefs = useStore((s) => s.setPrefs);
  const [modalSurface, setModalSurface] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const { hasPanels: showPanel } = useSurfaces();

  // Initialize plugin hooks (dashboard discovery, etc.)
  usePluginInit(agents, activeAgent);

  // Register memory inspector tabs as modal surfaces
  useMemorySurfaces({
    baseUrl: activeAgent?.baseUrl || "",
    token: activeAgent?.token || null,
  });

  const { messages, streamParts, thinking, activity, activityDetail, connected, status, send, loadMore, hasMore, loadingMore } = useAgent(activeAgent, { withHistory: true });
  const pinnedArray = useStore((s) => s.ui.pinnedStats);
  const togglePin = useStore((s) => s.togglePin);
  const pinned = useMemo(() => new Set(pinnedArray), [pinnedArray]);

  // KernBridge — stable API for desktop app (Tauri) and Android WebView
  useEffect(() => {
    const runningAgents = () => agents.filter((a) => a.running);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).KernBridge = {
      switchAgent(index: number) {
        const running = runningAgents();
        if (index >= 0 && index < running.length) setActive(agentKey(running[index]));
      },
      getAgents() {
        return runningAgents().map((a) => a.name);
      },
      getState() {
        return {
          agent: activeAgent?.name ?? null,
          connected,
          busy: thinking,
        };
      },
      send(text: string) {
        if (text) send(text);
      },
    };

    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      delete (window as any).KernBridge;
    };
  }, [agents, activeAgent, connected, thinking, send, setActive]);

  // Keyboard shortcuts: Cmd/Ctrl + 1..9 to switch agents
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      const n = parseInt(e.key);
      if (n >= 1 && n <= 9) {
        e.preventDefault();
        const running = agents.filter((a) => a.running);
        const idx = n - 1;
        if (idx < running.length) setActive(agentKey(running[idx]));
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [agents, setActive]);

  const handleDrop = useCallback(async (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = e.dataTransfer?.files;
    if (!files?.length) return;
    const atts: Attachment[] = [];
    for (const file of Array.from(files)) {
      if (file.size > 20 * 1024 * 1024) continue;
      atts.push(await fileToAttachment(file));
    }
    if (atts.length) setExternalAttachments((prev) => [...prev, ...atts]);
  }, []);

  return (
    <div className="flex h-full w-full">
      <Sidebar
        agents={agents}
        active={active}
        activeThinking={thinking}
        onSelect={setActive}
        onAddServer={addServer}
        onRemoveServer={removeServer}
        onAddAgent={addDirectAgent}
        onRemoveAgent={removeDirectAgent}
        onReorder={reorder}
      />

      <div
        className="flex-1 flex flex-col relative"
        style={{ minWidth: showPanel ? panelMinChatWidth() : 0 }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setDragOver(false);
        }}
        onDrop={handleDrop}
      >
        {/* Drag overlay */}
        {dragOver && (
          <div
            className="absolute inset-0 z-50 flex items-center justify-center"
            style={{
              background: "rgba(0,0,0,0.6)",
              backdropFilter: "blur(4px)",
            }}
          >
            <div className="text-base text-[var(--text-muted)] font-medium">
              Drop files to attach
            </div>
          </div>
        )}

        {/* Header */}
        <div className="h-12 border-b border-[var(--border)] flex items-center px-4 gap-3 flex-shrink-0">
          <div className="flex items-baseline gap-3">
            <button
              className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity"
              onClick={() => setInfoOpen((v) => !v)}
            >
              <span
                className={`w-2 h-2 rounded-full ${connected ? "bg-[var(--green)]" : "bg-[var(--text-muted)]"}`}
              />
              <span className="text-sm font-semibold">
                {activeAgent?.name || "no agent"}
              </span>
            </button>
            <PinnedStats status={status} pinned={pinned} baseUrl={activeAgent?.baseUrl} token={activeAgent?.token} />
          </div>
          <div className="ml-auto flex items-center gap-1">
            <ThemePicker />
            {/* Plugin header buttons */}
            {activeAgent && renderPluginHeaders({
              agentName: activeAgent.name,
              token: activeAgent.token,
              baseUrl: activeAgent.baseUrl,
            })}
            <button
              onClick={() => setModalSurface(MEMORY_SURFACE_ID)}
              className="px-1.5 py-1 text-sm rounded text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-surface)] transition-colors leading-none cursor-pointer"
              title="Memory"
            >
              ⋮
            </button>
          </div>
        </div>

        {/* Info panel */}
        {infoOpen && (
          <InfoPanel status={status} connected={connected} pinned={pinned} onTogglePin={togglePin} onClose={() => setInfoOpen(false)} baseUrl={activeAgent?.baseUrl} token={activeAgent?.token} />
        )}

        <Chat
          messages={messages}
          streamParts={streamParts}
          thinking={thinking}
          agentName={activeAgent?.name}
          token={activeAgent?.token ?? undefined}
          baseUrl={activeAgent?.baseUrl}
          layout={prefs.chatLayout}
          showTools={prefs.showTools}
          coloredTools={prefs.coloredTools}
          peekLastTool={prefs.peekLastTool}
          loadMore={loadMore}
          hasMore={hasMore}
          loadingMore={loadingMore}
        />

        {thinking && (
          <div style={{ maxWidth: prefs.chatLayout === "flat" ? undefined : 800, margin: "0 auto", width: "100%", paddingLeft: prefs.chatLayout === "flat" ? 58 : 32, paddingRight: 16 }}>
            <ThinkingDots agentName={prefs.chatLayout === "flat" ? activeAgent?.name : undefined} activity={activity} detail={activityDetail} />
          </div>
        )}

        <Input
          onSend={(text: string, attachments?: Attachment[]) => send(text, attachments)}
          disabled={!connected}
          externalAttachments={externalAttachments}
          onExternalConsumed={() => setExternalAttachments([])}
          fullWidth={prefs.chatLayout === "flat"}
          agentName={activeAgent?.name}
          baseUrl={activeAgent?.baseUrl}
          token={activeAgent?.token}
        />
      </div>

      {/* Surface: modal overlay (Memory inspector, etc.) */}
      <SurfaceModal
        openSurface={modalSurface}
        onClose={() => setModalSurface(null)}
      />

      {/* Surface: side panel (dashboards, etc.) */}
      {showPanel && <SurfacePanel />}
    </div>
  );
}
