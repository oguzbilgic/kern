"use client";

import type { Agent } from "../lib/types";

const AVATAR_COLORS = ["#e06c75", "#e5c07b", "#98c379", "#56b6c2", "#61afef", "#c678dd", "#be5046", "#d19a66"];

function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

interface SidebarProps {
  agents: Agent[];
  active: string | null;
  onSelect: (name: string) => void;
  onLogout?: () => void;
}

export function Sidebar({ agents, active, onSelect, onLogout }: SidebarProps) {
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

      {/* Agent list */}
      <div className="flex-1 overflow-y-auto p-2">
        {agents.map((agent) => {
          const isActive = agent.name === active;
          return (
            <button
              key={agent.name}
              onClick={() => onSelect(agent.name)}
              className={`flex items-center gap-2.5 w-full px-2 py-1.5 rounded text-sm text-left transition-colors ${
                isActive
                  ? "bg-[var(--bg-surface)]"
                  : "hover:bg-[var(--bg-surface)]/50"
              }`}
            >
              {/* Avatar */}
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold uppercase flex-shrink-0"
                style={{ backgroundColor: avatarColor(agent.name) + "33", color: avatarColor(agent.name) }}
              >
                {agent.name[0]}
              </div>

              {/* Name + status */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="truncate">{agent.name}</span>
                  <span
                    className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      agent.running ? "bg-[var(--green)]" : "bg-[var(--text-muted)]"
                    }`}
                  />
                </div>
              </div>
            </button>
          );
        })}

        {agents.length === 0 && (
          <div className="text-xs text-[var(--text-muted)] px-2 py-4">
            No agents found.
          </div>
        )}
      </div>
    </div>
  );
}
