"use client";

import { useState, useEffect } from "react";
import type { AgentInfo } from "../lib/types";
import { useAgent } from "../hooks/useAgent";
import { agentKey } from "../hooks/useServers";

import { avatarColor } from "../lib/colors";

function AgentRow({
  agent,
  isActive,
  activeThinking,
  mini,
  onSelect,
}: {
  agent: AgentInfo;
  isActive: boolean;
  activeThinking?: boolean;
  mini: boolean;
  onSelect: () => void;
}) {
  const light = useAgent(isActive ? null : agent, { withHistory: false });
  const thinking = isActive ? activeThinking : light.thinking;
  const unread = isActive ? 0 : light.unread;

  return (
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
  );
}

interface SidebarProps {
  agents: AgentInfo[];
  active: string | null;
  activeThinking?: boolean;
  onSelect: (key: string) => void;
  onLogout?: () => void;
  onAddServer?: (url: string, token: string) => void;
  onRemoveServer?: (url: string) => void;
}

export function Sidebar({ agents, active, activeThinking, onSelect, onLogout, onAddServer, onRemoveServer }: SidebarProps) {
  const [showAddModal, setShowAddModal] = useState(false);
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

  // Group agents by server
  const grouped = new Map<string, AgentInfo[]>();
  for (const agent of agents) {
    const server = agent.serverUrl || "local";
    if (!grouped.has(server)) grouped.set(server, []);
    grouped.get(server)!.push(agent);
  }

  function handleAddServer() {
    if (!newUrl.trim()) return;
    onAddServer?.(newUrl.trim(), newToken.trim());
    setNewUrl("");
    setNewToken("");
    setShowAddModal(false);
  }

  return (
    <div
      className="bg-[var(--bg-sidebar)] flex flex-col flex-shrink-0 transition-[width] duration-200 relative overflow-hidden"
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
        {Array.from(grouped.entries()).map(([server, serverAgents]) => (
          <div key={server} className="mb-1.5">
            {/* Server header — only for remote, clips in mini */}
            {server !== "local" && (
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
            )}

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
          <div className="text-xs text-[var(--text-muted)] px-2 py-4">
            No agents found.
          </div>
        )}

        {/* Add server row — matches agent row style */}
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2.5 w-full rounded-lg text-sm text-left transition-colors cursor-pointer p-2.5 mb-0.5 overflow-hidden hover:bg-white/[0.05]"
          title="Add server"
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
          <span className="text-[var(--text-muted)] text-xs whitespace-nowrap">Add server</span>
        </button>
      </div>

      {/* Footer: logout */}
      {onLogout && (
        <div className="py-2 px-4 border-t border-[var(--border)] flex justify-end">
          <button
            onClick={onLogout}
            className="text-[var(--text-muted)] hover:text-[var(--text-dim)] transition-colors cursor-pointer"
            title="Logout"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M6 2H4a2 2 0 00-2 2v8a2 2 0 002 2h2" />
              <path d="M10 11l3-3-3-3" />
              <line x1="6" y1="8" x2="13" y2="8" />
            </svg>
          </button>
        </div>
      )}

      {/* Add server modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowAddModal(false)}>
          <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg p-4 w-80" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-semibold mb-3">Add Server</div>
            <input
              type="text"
              placeholder="Server URL (e.g. http://host:8080)"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-[var(--bg-input)] border border-[var(--border)] rounded mb-2 text-[var(--text)] placeholder-[var(--text-muted)] outline-none focus:border-[var(--accent-dim)]"
            />
            <input
              type="password"
              placeholder="Access token"
              value={newToken}
              onChange={(e) => setNewToken(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-[var(--bg-input)] border border-[var(--border)] rounded mb-3 text-[var(--text)] placeholder-[var(--text-muted)] outline-none focus:border-[var(--accent-dim)]"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowAddModal(false)}
                className="text-xs text-[var(--text-muted)] hover:text-[var(--text-dim)] px-3 py-1.5"
              >
                Cancel
              </button>
              <button
                onClick={handleAddServer}
                disabled={!newUrl.trim()}
                className="text-xs bg-[var(--accent)] text-white px-3 py-1.5 rounded disabled:opacity-30 hover:opacity-90"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
