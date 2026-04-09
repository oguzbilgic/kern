"use client";

import { useState, useCallback, useEffect, type DragEvent } from "react";
import { useAuth } from "../hooks/useAuth";
import { useServers, agentKey } from "../hooks/useServers";
import { useAgent } from "../hooks/useAgent";
import { Login } from "../components/Login";
import { Sidebar } from "../components/Sidebar";
import { Chat } from "../components/Chat";
import { Input, fileToAttachment } from "../components/Input";
import { InfoPanel, PinnedStats } from "../components/InfoPanel";
import { ThemePicker, usePreferences } from "../components/ThemePicker";
import { ThinkingDots } from "../components/ThinkingDots";
import { SurfaceModal, SurfacePanel, panelMinChatWidth } from "../components/SurfaceManager";
import { useSurfaces } from "../lib/surfaces";
import { useMemorySurfaces, MEMORY_SURFACE_ID } from "../components/inspector";
import { renderPluginHeaders } from "../plugins/registry";
import { usePluginInit } from "../plugins";
import type { Attachment } from "../lib/types";

export default function Home() {
  const { token, setToken } = useAuth();
  const validToken = token ?? null;
  const { agents, activeAgent, active, setActive, addServer, removeServer } = useServers(validToken);
  const [dragOver, setDragOver] = useState(false);
  const [externalAttachments, setExternalAttachments] = useState<Attachment[]>([]);
  const { prefs, setPrefs } = usePreferences();
  const [modalSurface, setModalSurface] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const { hasPanels: showPanel } = useSurfaces();

  // Initialize plugin hooks (dashboard discovery, etc.)
  usePluginInit(agents, activeAgent);

  // Register memory inspector tabs as modal surfaces
  useMemorySurfaces({
    agentName: activeAgent?.name || "",
    token: activeAgent?.token || null,
    serverUrl: activeAgent?.serverUrl,
  });

  const { messages, streamParts, thinking, activity, activityDetail, connected, status, send, loadMore, hasMore, loadingMore } = useAgent(activeAgent, { withHistory: true });
  const [pinned, setPinned] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const saved = localStorage.getItem("kern-pinned-stats");
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });

  const togglePin = useCallback((key: string) => {
    setPinned((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      localStorage.setItem("kern-pinned-stats", JSON.stringify([...next]));
      return next;
    });
  }, []);

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

  if (token === undefined) {
    return <div className="h-full w-full bg-[var(--bg)]" />;
  }

  if (!token) {
    return <Login onLogin={setToken} />;
  }

  function handleLogout() {
    localStorage.removeItem("kern-token");
    const tauri = (window as any).__TAURI__;
    if (tauri?.core?.invoke) {
      window.location.replace("tauri://localhost/index.html?logout=1");
    } else {
      window.location.reload();
    }
  }

  return (
    <div className="flex h-full w-full">
      <Sidebar
        agents={agents}
        active={active}
        activeThinking={thinking}
        onSelect={setActive}
        onLogout={handleLogout}
        onAddServer={addServer}
        onRemoveServer={removeServer}
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
            <PinnedStats status={status} pinned={pinned} />
          </div>
          <div className="ml-auto flex items-center gap-1">
            <ThemePicker prefs={prefs} onPrefsChange={setPrefs} />
            {/* Plugin header buttons */}
            {activeAgent && renderPluginHeaders({
              agentName: activeAgent.name,
              token: activeAgent.token,
              serverUrl: activeAgent.serverUrl,
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
          <InfoPanel status={status} connected={connected} pinned={pinned} onTogglePin={togglePin} onClose={() => setInfoOpen(false)} />
        )}

        <Chat
          messages={messages}
          streamParts={streamParts}
          thinking={thinking}
          agentName={activeAgent?.name}
          token={activeAgent?.token ?? undefined}
          serverUrl={activeAgent?.serverUrl}
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
