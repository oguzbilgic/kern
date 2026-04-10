"use client";

import { useState, useEffect } from "react";
import type { AgentInfo } from "../lib/types";
import { useAgent } from "../hooks/useAgent";
import { agentKey } from "../hooks/useAgents";
import { renderPluginSidebars } from "../plugins/registry";
import { avatarColor } from "../lib/colors";

function AgentRow({
  agent,
  isActive,
  activeThinking,
  mini,
  onSelect,
  onRemove,
}: {
  agent: AgentInfo;
  isActive: boolean;
  activeThinking?: boolean;
  mini: boolean;
  onSelect: () => void;
  onRemove?: () => void;
}) {
  const light = useAgent(isActive ? null : agent, { withHistory: false });
  const thinking = isActive ? activeThinking : light.thinking;
  const unread = isActive ? 0 : light.unread;

  return (
    <div className="relative group">
      <button
        onClick={onSelect}
        className={`flex items-center gap-2.5 w-full rounded-lg text-sm text-left transition-colors cursor-pointer p-2.5 mb-0.5 overflow-hidden ${
          isActive ? "bg-white/[0.08]" : "hover:bg-white/[0.05]"
        } ${!agent.running ? "opacity-50" : ""}`}
        title={mini ? agent.name : undefined}
      >
        {/* Avatar with status dot / unread badge */}
        <div className="relative flex-shrink-0">
          <div
            className="w-10 h-10 flex items-center justify-center text-[16px] font-bold uppercase"
            style={{ borderRadius: "22%", backgroundColor: avatarColor(agent.name), color: "#fff" }}
          >
            {agent.name[0]}
          </div>
          {(thinking || !agent.running || (unread > 0 && !isActive)) && (
            <span
              className={`absolute flex items-center justify-center rounded-full border-2 border-[var(--bg-sidebar)] transition-all duration-200 ${
                unread > 0 && !isActive
                  ? "w-[18px] h-[18px] -bottom-[3px] -right-[3px] bg-[var(--accent)] text-[10px] font-bold text-[var(--bg)]"
                  : "w-3 h-3 bottom-0 right-0"
              } ${
                thinking
                  ? "bg-[var(--accent)] [animation:dot-pulse_1.5s_ease-in-out_infinite]"
                  : unread > 0 && !isActive
                    ? ""
                    : "bg-[var(--text-muted)]"
              }`}
            >
              {unread > 0 && !isActive ? (unread > 99 ? "99+" : unread) : ""}
            </span>
          )}
        </div>

        {/* Name — always rendered, clipped by overflow */}
        <div className="flex-1 min-w-0">
          <span className="truncate whitespace-nowrap">{agent.name}</span>
        </div>
      </button>
      {/* Remove button for direct agents */}
      {onRemove && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className={`absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-red-400 hover:bg-[var(--bg-hover)] opacity-0 group-hover:opacity-100 transition-opacity text-xs ${mini ? "right-0.5 w-4 h-4" : ""}`}
          title="Remove agent"
        >
          ✕
        </button>
      )}
    </div>
  );
}

type AddMode = "agent" | "server";

interface SidebarProps {
  agents: AgentInfo[];
  active: string | null;
  activeThinking?: boolean;
  onSelect: (key: string) => void;
  onAddServer?: (url: string, token: string) => void;
  onRemoveServer?: (url: string) => void;
  onAddAgent?: (url: string, token: string) => void;
  onRemoveAgent?: (url: string) => void;
}

export function Sidebar({ agents, active, activeThinking, onSelect, onAddServer, onRemoveServer, onAddAgent, onRemoveAgent }: SidebarProps) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [addMode, setAddMode] = useState<AddMode>("agent");
  const [newUrl, setNewUrl] = useState("");
  const [newToken, setNewToken] = useState("");


  // Mini/full state persisted in localStorage
  const [mini, setMini] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("kern-sidebar-mini") === "true";
  });
  const [userSet, setUserSet] = useState(false); // track manual toggle

  useEffect(() => {
    localStorage.setItem("kern-sidebar-mini", String(mini));
  }, [mini]);

  // Manual toggle wrapper
  function toggleMini() {
    setUserSet(true);
    setMini((m) => !m);
  }

  // Auto-collapse on narrow, auto-expand on wide — unless user manually toggled
  useEffect(() => {
    function check() {
      if (window.innerWidth < 768) {
        setMini(true);
        setUserSet(false); // reset so widening will auto-expand
      } else if (window.innerWidth >= 1024 && !userSet) {
        setMini(false);
      }
    }
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [userSet]);

  // Group agents: proxy agents have "/api/agents/" in baseUrl, direct don't
  const proxyGroups = new Map<string, AgentInfo[]>();
  const directAgents: AgentInfo[] = [];
  for (const agent of agents) {
    const proxyIdx = agent.baseUrl.indexOf("/api/agents/");
    if (proxyIdx >= 0) {
      const server = agent.baseUrl.slice(0, proxyIdx);
      if (!proxyGroups.has(server)) proxyGroups.set(server, []);
      proxyGroups.get(server)!.push(agent);
    } else {
      directAgents.push(agent);
    }
  }

  function normalizeUrl(raw: string): string {
    let url = raw.trim();
    if (!url) return url;
    // Add http:// if no protocol
    if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
    // Strip trailing slash
    return url.replace(/\/+$/, "");
  }

  function handleAdd() {
    const url = normalizeUrl(newUrl);
    if (!url) return;
    if (addMode === "server") {
      onAddServer?.(url, newToken.trim());
    } else {
      onAddAgent?.(url, newToken.trim());
    }
    setNewUrl("");
    setNewToken("");
    setShowAddModal(false);
  }

  // Get the active agent name for plugin sidebar context
  const activeAgentObj = agents.find(a => agentKey(a) === active);

  return (
    <div
      className="bg-[var(--bg-sidebar)] flex flex-col flex-shrink-0 transition-[width] duration-200 relative overflow-hidden"
      data-sidebar
      style={{ width: mini ? 75 : 200 }}
    >
      {/* Right edge toggle strip */}
      <div
        onClick={toggleMini}
        className="absolute top-0 right-0 w-[2px] h-full cursor-col-resize hover:bg-[var(--accent)] transition-colors duration-150 z-10"
        style={{ background: "var(--border)" }}
        title={mini ? "Expand sidebar" : "Collapse sidebar"}
      />
      {/* Header: logo toggles mini/full */}
      <div className="h-12 flex items-center border-b border-[var(--border)] px-4 whitespace-nowrap">
        <button
          onClick={toggleMini}
          className="cursor-pointer hover:opacity-80 transition-opacity"
          title={mini ? "Expand sidebar" : "Collapse sidebar"}
        >
          <span className="text-sm font-semibold">
            kern<span className="text-[var(--accent)]">.</span>
          </span>
        </button>
      </div>

      {/* Agent list */}
      <div className="flex-1 overflow-y-auto p-2">
        {/* Direct agents — no header */}
        {directAgents.length > 0 && (
          <div className="mb-1.5">
            {directAgents.map((agent) => {
              const key = agentKey(agent);
              return (
                <AgentRow
                  key={key}
                  agent={agent}
                  isActive={key === active}
                  activeThinking={key === active ? activeThinking : undefined}
                  mini={mini}
                  onSelect={() => onSelect(key)}
                  onRemove={() => onRemoveAgent?.(agent.baseUrl)}
                />
              );
            })}
          </div>
        )}

        {/* Proxy server groups */}
        {Array.from(proxyGroups.entries()).map(([server, serverAgents]) => (
          <div key={server} className="mb-1.5">
            <div className="flex items-center justify-between px-2 mb-1">
              <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider truncate">
                {server.replace(/^https?:\/\//, "")}
              </span>
              <button
                onClick={() => onRemoveServer?.(server)}
                className="text-[10px] text-[var(--text-muted)] hover:text-red-400"
                title="Remove server"
              >
                ×
              </button>
            </div>
            {serverAgents.map((agent) => {
              const key = agentKey(agent);
              return (
                <AgentRow
                  key={key}
                  agent={agent}
                  isActive={key === active}
                  activeThinking={key === active ? activeThinking : undefined}
                  mini={mini}
                  onSelect={() => onSelect(key)}
                />
              );
            })}
          </div>
        ))}

        {agents.length === 0 && (
          <div className="text-xs text-[var(--text-muted)] px-2 py-4 text-center">
            Add an agent to get started.
          </div>
        )}

        {/* Add button — after agents */}
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2.5 w-full rounded-lg text-sm text-left transition-colors cursor-pointer p-2.5 mb-0.5 overflow-hidden hover:bg-white/[0.05]"
          title="Add agent or server"
        >
          <div className="relative flex-shrink-0">
            <div className="w-10 h-10 flex items-center justify-center border border-dashed border-[var(--text-muted)]"
              style={{ borderRadius: "22%" }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round">
                <line x1="8" y1="4" x2="8" y2="12" />
                <line x1="4" y1="8" x2="12" y2="8" />
              </svg>
            </div>
          </div>
          <span className="text-[var(--text-muted)] text-xs whitespace-nowrap">Add</span>
        </button>

        {/* Plugin sidebar sections */}
        {renderPluginSidebars({ agents, activeAgent: activeAgentObj?.name ?? null, mini })}
      </div>

      {/* Add modal — agent or server */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowAddModal(false)}>
          <div className="bg-[#1a1a1a] border border-[var(--border)] rounded-lg shadow-xl w-[340px]" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
              <span className="text-[13px] font-medium text-[var(--text)]">Add connection</span>
              <button
                onClick={() => setShowAddModal(false)}
                className="w-5 h-5 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)] transition-colors cursor-pointer text-sm"
              >✕</button>
            </div>

            {/* Tab switcher */}
            <div className="flex px-4 gap-4 border-b border-[var(--border)]">
              {(["agent", "server"] as AddMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setAddMode(mode)}
                  className={`text-xs pb-2 transition-colors cursor-pointer border-b-2 -mb-px ${
                    addMode === mode
                      ? "border-[var(--text-dim)] text-[var(--text)]"
                      : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-dim)]"
                  }`}
                >
                  {mode === "agent" ? "Agent" : "Proxy server"}
                </button>
              ))}
            </div>

            {/* Form */}
            <div className="px-4 pt-3 pb-4">
              <p className="text-[11px] text-[var(--text-muted)] mb-3 leading-relaxed">
                {addMode === "agent"
                  ? "Connect directly to a running agent."
                  : "Connect to a kern web proxy managing multiple agents."}
              </p>

              <label className="block text-[10px] text-[var(--text-muted)] mb-1">
                {addMode === "agent" ? "URL" : "Server URL"}
              </label>
              <input
                type="text"
                placeholder={addMode === "agent" ? "host:4100" : "host:8080"}
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg mb-3 text-[var(--text)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-dim)] transition-colors"
                autoFocus
              />

              <label className="block text-[10px] text-[var(--text-muted)] mb-1">Token</label>
              <input
                type="password"
                placeholder={addMode === "agent" ? "KERN_AUTH_TOKEN" : "KERN_WEB_TOKEN"}
                value={newToken}
                onChange={(e) => setNewToken(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg mb-4 text-[var(--text)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent-dim)] transition-colors"
                onKeyDown={(e) => { if (e.key === "Enter" && newUrl.trim()) handleAdd(); }}
              />

              <button
                onClick={handleAdd}
                disabled={!newUrl.trim()}
                className="w-full text-sm py-2 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] transition-colors cursor-pointer text-[var(--text)] hover:border-[var(--text-muted)] disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Connect
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
