"use client";

import { useState } from "react";
import type { AgentInfo } from "../lib/types";
import { useAgent } from "../hooks/useAgent";
import { agentKey } from "../hooks/useServers";

const AVATAR_COLORS = ["#e06c75", "#e5c07b", "#98c379", "#56b6c2", "#61afef", "#c678dd", "#be5046", "#d19a66"];

function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// Each agent row has its own light useAgent for SSE status
function AgentRow({
  agent,
  isActive,
  activeThinking,
  onSelect,
}: {
  agent: AgentInfo;
  isActive: boolean;
  activeThinking?: boolean;
  onSelect: () => void;
}) {
  // Active agent's useAgent is in page.tsx (withHistory: true).
  // Skip light SSE here to avoid duplicate connection.
  const light = useAgent(isActive ? null : agent, { withHistory: false });

  // Active agent gets thinking from props, background agents from light SSE
  const thinking = isActive ? activeThinking : light.thinking;
  const unread = isActive ? 0 : light.unread;

  return (
    <button
      onClick={onSelect}
      className={`flex items-center gap-2.5 w-full px-2 py-1.5 rounded text-sm text-left transition-colors cursor-pointer ${
        isActive
          ? "bg-[var(--bg-surface)]"
          : "hover:bg-[var(--bg-surface)]/50"
      } ${!agent.running ? "opacity-50" : ""}`}
    >
      {/* Avatar with status dot / unread badge */}
      <div className="relative flex-shrink-0">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold uppercase"
          style={{ backgroundColor: avatarColor(agent.name), color: "#fff" }}
        >
          {agent.name[0]}
        </div>
        {/* Unified dot: grows into unread badge, pulses when thinking, muted when offline */}
        {(thinking || !agent.running || (unread > 0 && !isActive)) && (
          <span
            className={`absolute flex items-center justify-center rounded-full border-2 border-[var(--bg-sidebar)] transition-all duration-200 ${
              unread > 0 && !isActive
                ? "w-[18px] h-[18px] -bottom-[3px] -right-[3px] bg-[var(--accent)] text-[10px] font-bold text-[var(--bg)]"
                : "w-3 h-3 bottom-0 right-0"
            } ${
              thinking
                ? "bg-[var(--accent)] animate-pulse"
                : unread > 0 && !isActive
                  ? ""
                  : "bg-[var(--text-muted)]"
            }`}
          >
            {unread > 0 && !isActive ? (unread > 99 ? "99+" : unread) : ""}
          </span>
        )}
      </div>

      {/* Name */}
      <div className="flex-1 min-w-0">
        <span className="truncate">{agent.name}</span>
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
    <div className="w-[200px] bg-[var(--bg-sidebar)] border-r border-[var(--border)] flex flex-col flex-shrink-0">
      {/* Logo + logout */}
      <div className="h-12 flex items-center justify-between px-4 border-b border-[var(--border)]">
        <span className="text-sm font-semibold">
          kern<span className="text-[var(--accent)]">.</span>
        </span>
        {onLogout && (
          <button
            onClick={onLogout}
            className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-dim)] transition-colors"
            title="Logout"
          >
            Logout
          </button>
        )}
      </div>

      {/* Agent list grouped by server */}
      <div className="flex-1 overflow-y-auto p-2">
        {Array.from(grouped.entries()).map(([server, serverAgents]) => (
          <div key={server} className="mb-3">
            {/* Server header — only show for remote servers */}
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
      </div>

      {/* Add server button */}
      <div className="p-2 border-t border-[var(--border)]">
        <button
          onClick={() => setShowAddModal(true)}
          className="w-full text-xs text-[var(--text-muted)] hover:text-[var(--text-dim)] py-1.5 transition-colors"
        >
          + Add server
        </button>
      </div>

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
