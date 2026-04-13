"use client";

import { useState, useEffect, useRef } from "react";
import type { AgentInfo } from "../lib/types";
import { useAgent } from "../hooks/useAgent";
import { agentKey } from "../hooks/useAgents";
import { renderPluginSidebars } from "../plugins/registry";
import { avatarColor } from "../lib/colors";
import { useStore } from "../lib/store";
import type { AgentGroup } from "../lib/store";

/* ── Agent avatar row ─────────────────────────────────────────────── */

function AgentRow({
  agent,
  isActive,
  activeThinking,
  mini,
  onSelect,
  onMenuOpen,
}: {
  agent: AgentInfo;
  isActive: boolean;
  activeThinking?: boolean;
  mini: boolean;
  onSelect: () => void;
  onMenuOpen?: (e: React.MouseEvent) => void;
}) {
  const light = useAgent(isActive ? null : agent, { withHistory: false });
  const thinking = isActive ? activeThinking : light.thinking;
  const unread = isActive ? 0 : light.unread;

  return (
    <div className="relative group">
      <button
        onClick={onSelect}
        onContextMenu={onMenuOpen}
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
      {/* Three-dot menu button for direct agents — hidden in mini mode */}
      {onMenuOpen && !mini && (
        <button
          onClick={(e) => { e.stopPropagation(); onMenuOpen(e); }}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)] opacity-0 group-hover:opacity-100 transition-opacity text-xs"
          title="Agent options"
        >
          ⋯
        </button>
      )}
    </div>
  );
}

/* ── Context menu (dropdown) ──────────────────────────────────────── */

interface MenuPosition { x: number; y: number }
interface MenuEntry { label: string; onClick: () => void; danger?: boolean }

function ContextMenu({ pos, items, onClose }: { pos: MenuPosition; items: MenuEntry[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-[100] bg-[var(--bg)] border border-[var(--border)] rounded-lg shadow-lg py-1 min-w-[160px]"
      style={{ top: pos.y, left: pos.x }}
    >
      {items.map((item, i) => (
        <button
          key={i}
          onClick={() => { item.onClick(); onClose(); }}
          className={`w-full text-left text-xs px-3 py-1.5 transition-colors cursor-pointer ${
            item.danger
              ? "text-red-400 hover:bg-red-400/10"
              : "text-[var(--text-dim)] hover:bg-white/[0.06]"
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

/* ── Submenu for "Move to group" ──────────────────────────────────── */

function MoveToGroupMenu({
  pos,
  groups,
  currentGroupId,
  onMoveToGroup,
  onNewGroup,
  onMoveToUngrouped,
  onClose,
}: {
  pos: MenuPosition;
  groups: AgentGroup[];
  currentGroupId: string | null;
  onMoveToGroup: (groupId: string) => void;
  onNewGroup: () => void;
  onMoveToUngrouped: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-[100] bg-[var(--bg)] border border-[var(--border)] rounded-lg shadow-lg py-1 min-w-[160px]"
      style={{ top: pos.y, left: pos.x }}
    >
      {currentGroupId && (
        <button
          onClick={() => { onMoveToUngrouped(); onClose(); }}
          className="w-full text-left text-xs px-3 py-1.5 text-[var(--text-dim)] hover:bg-white/[0.06] transition-colors cursor-pointer"
        >
          Ungrouped
        </button>
      )}
      {groups.filter(g => g.id !== currentGroupId).map((g) => (
        <button
          key={g.id}
          onClick={() => { onMoveToGroup(g.id); onClose(); }}
          className="w-full text-left text-xs px-3 py-1.5 text-[var(--text-dim)] hover:bg-white/[0.06] transition-colors cursor-pointer"
        >
          {g.name}
        </button>
      ))}
      <div className="border-t border-[var(--border)] my-1" />
      <button
        onClick={() => { onNewGroup(); onClose(); }}
        className="w-full text-left text-xs px-3 py-1.5 text-[var(--text-dim)] hover:bg-white/[0.06] transition-colors cursor-pointer"
      >
        New group…
      </button>
    </div>
  );
}

/* ── Sidebar ──────────────────────────────────────────────────────── */

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
  onReorder?: (from: number, to: number) => void;
}

export function Sidebar({ agents, active, activeThinking, onSelect, onAddServer, onRemoveServer, onAddAgent, onRemoveAgent, onReorder }: SidebarProps) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [addMode, setAddMode] = useState<AddMode>("agent");
  const [newUrl, setNewUrl] = useState("");
  const [newToken, setNewToken] = useState("");
  

  // Agent context menu
  const [agentMenu, setAgentMenu] = useState<{ agentUrl: string; pos: MenuPosition } | null>(null);
  const [moveToGroupMenu, setMoveToGroupMenu] = useState<{ agentUrl: string; currentGroupId: string | null; pos: MenuPosition } | null>(null);
  const [groupMenu, setGroupMenu] = useState<{ groupId: string; pos: MenuPosition } | null>(null);
  
  const [groupModal, setGroupModal] = useState<{ mode: "create"; agentUrl: string } | { mode: "rename"; groupId: string } | null>(null);
  const [groupModalName, setGroupModalName] = useState("");

  // Group drag state
  const [dragGroupIndex, setDragGroupIndex] = useState<number | null>(null);
  const [dropGroupIndex, setDropGroupIndex] = useState<number | null>(null);

  // Agent drag within/between groups
  const [dragAgentUrl, setDragAgentUrl] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ groupId: string | null; index: number } | null>(null);

  // Mini/full state from store
  const mini = useStore((s) => s.ui.sidebarMini);
  const setSidebarMini = useStore((s) => s.setSidebarMini);
  const [userSet, setUserSet] = useState(false);

  // Group state from store
  const agentGroups = useStore((s) => s.ui.agentGroups);
  const groupOrder = useStore((s) => s.ui.groupOrder);
  const createGroup = useStore((s) => s.createGroup);
  const renameGroup = useStore((s) => s.renameGroup);
  const deleteGroup = useStore((s) => s.deleteGroup);
  const moveAgentToGroup = useStore((s) => s.moveAgentToGroup);
  const removeAgentFromGroup = useStore((s) => s.removeAgentFromGroup);
  const toggleGroupCollapsed = useStore((s) => s.toggleGroupCollapsed);
  const reorderGroups = useStore((s) => s.reorderGroups);
  const reorderAgentInGroup = useStore((s) => s.reorderAgentInGroup);

  // Manual toggle wrapper
  function toggleMini() {
    setUserSet(true);
    setSidebarMini(!mini);
  }

  // Auto-collapse on narrow, auto-expand on wide — unless user manually toggled
  useEffect(() => {
    function check() {
      if (window.innerWidth < 768) {
        setSidebarMini(true);
        setUserSet(false);
      } else if (window.innerWidth >= 1024 && !userSet) {
        setSidebarMini(false);
      }
    }
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [userSet]);

  // Group agents: proxy agents have "/api/agents/" in baseUrl, direct don't
  const proxyGroups = new Map<string, AgentInfo[]>();
  const directAgents: { agent: AgentInfo; globalIndex: number }[] = [];
  for (let idx = 0; idx < agents.length; idx++) {
    const agent = agents[idx];
    const proxyIdx = agent.baseUrl.indexOf("/api/agents/");
    if (proxyIdx >= 0) {
      const server = agent.baseUrl.slice(0, proxyIdx);
      if (!proxyGroups.has(server)) proxyGroups.set(server, []);
      proxyGroups.get(server)!.push(agent);
    } else {
      directAgents.push({ agent, globalIndex: idx });
    }
  }

  // Build grouped and ungrouped agent lists for direct agents
  const groupedUrls = new Set(agentGroups.flatMap((g) => g.agentUrls));
  const ungroupedAgents = directAgents.filter(({ agent }) => !groupedUrls.has(agent.baseUrl));

  // Ordered groups: use groupOrder, then any groups not in the order
  const orderedGroups: AgentGroup[] = [];
  const groupMap = new Map(agentGroups.map((g) => [g.id, g]));
  for (const id of groupOrder) {
    const g = groupMap.get(id);
    if (g) orderedGroups.push(g);
  }
  for (const g of agentGroups) {
    if (!groupOrder.includes(g.id)) orderedGroups.push(g);
  }

  // Resolve group agents (only those present in directAgents)
  const directAgentMap = new Map(directAgents.map(({ agent }) => [agent.baseUrl, agent]));
  function resolveGroupAgents(group: AgentGroup): AgentInfo[] {
    return group.agentUrls.map((url) => directAgentMap.get(url)).filter((a): a is AgentInfo => a !== undefined);
  }

  function normalizeUrl(raw: string): string {
    let url = raw.trim();
    if (!url) return url;
    if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
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

  // Find which group an agent belongs to
  function findGroupForAgent(agentUrl: string): string | null {
    for (const g of agentGroups) {
      if (g.agentUrls.includes(agentUrl)) return g.id;
    }
    return null;
  }

  // Handle agent three-dot menu
  function openAgentMenu(agentUrl: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setAgentMenu({ agentUrl, pos: { x: e.clientX, y: e.clientY } });
    setMoveToGroupMenu(null);
    setGroupMenu(null);
  }

  // Handle group three-dot menu
  function openGroupMenu(groupId: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setGroupMenu({ groupId, pos: { x: e.clientX, y: e.clientY } });
    setAgentMenu(null);
    setMoveToGroupMenu(null);
  }

  // Handle new group creation prompt
  function handleGroupModalSubmit() {
    const name = groupModalName.trim();
    if (!name || !groupModal) return;
    if (groupModal.mode === "create") {
      createGroup(name, groupModal.agentUrl);
    } else {
      renameGroup(groupModal.groupId, name);
    }
    setGroupModal(null);
    setGroupModalName("");
  }

  // Handle rename submit
  

  // Handle agent drag into ungrouped zone
  function handleUngroupedDragOver(e: React.DragEvent) {
    e.preventDefault();
    if (dragAgentUrl) {
      setDropTarget({ groupId: null, index: -1 });
    }
  }

  function handleUngroupedDrop(e: React.DragEvent) {
    e.preventDefault();
    if (dragAgentUrl) {
      removeAgentFromGroup(dragAgentUrl);
    }
    setDragAgentUrl(null);
    setDropTarget(null);
  }

  // Handle agent drag into group zone
  function handleGroupDragOver(groupId: string, index: number, e: React.DragEvent) {
    e.preventDefault();
    if (dragAgentUrl) {
      setDropTarget({ groupId, index });
    }
  }

  function handleGroupDrop(groupId: string, e: React.DragEvent) {
    e.preventDefault();
    if (dragAgentUrl) {
      const currentGroupId = findGroupForAgent(dragAgentUrl);
      if (currentGroupId === groupId && dropTarget?.groupId === groupId && dropTarget.index >= 0) {
        // Reorder within same group
        const fromIdx = agentGroups.find(g => g.id === groupId)?.agentUrls.indexOf(dragAgentUrl) ?? -1;
        if (fromIdx >= 0 && fromIdx !== dropTarget.index) {
          reorderAgentInGroup(groupId, fromIdx, dropTarget.index);
        }
      } else {
        moveAgentToGroup(dragAgentUrl, groupId);
      }
    }
    setDragAgentUrl(null);
    setDropTarget(null);
  }

  // Get the active agent name for plugin sidebar context
  const activeAgentObj = agents.find(a => agentKey(a) === active);

  // Render a single draggable agent row
  function renderAgentItem(agent: AgentInfo, globalIndex: number, groupId: string | null, indexInGroup: number) {
    const key = agentKey(agent);
    const isDropTarget = dropTarget?.groupId === groupId &&
      dropTarget?.index === indexInGroup &&
      dragAgentUrl !== null && dragAgentUrl !== agent.baseUrl;

    return (
      <div
        key={key}
        draggable
        onDragStart={(e) => {
          setDragAgentUrl(agent.baseUrl);
          e.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (dragAgentUrl) {
            setDropTarget({ groupId, index: indexInGroup });
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!dragAgentUrl) return;
          const fromGroup = findGroupForAgent(dragAgentUrl);
          if (fromGroup === groupId && groupId !== null) {
            // Reorder within same group
            const fromIdx = agentGroups.find(g => g.id === groupId)?.agentUrls.indexOf(dragAgentUrl) ?? -1;
            if (fromIdx >= 0 && dropTarget && fromIdx !== dropTarget.index) {
              reorderAgentInGroup(groupId, fromIdx, dropTarget.index);
            }
          } else if (groupId !== null) {
            // Move into a group
            moveAgentToGroup(dragAgentUrl, groupId);
          } else if (fromGroup !== null) {
            // Drop onto ungrouped — remove from group
            removeAgentFromGroup(dragAgentUrl);
          } else {
            // Ungrouped reorder
            const fromIdx = ungroupedAgents.findIndex(u => u.agent.baseUrl === dragAgentUrl);
            if (fromIdx >= 0 && fromIdx !== indexInGroup) {
              onReorder?.(ungroupedAgents[fromIdx].globalIndex, globalIndex);
            }
          }
          setDragAgentUrl(null);
          setDropTarget(null);
        }}
        onDragEnd={() => {
          setDragAgentUrl(null);
          setDropTarget(null);
        }}
        className="relative"
        style={isDropTarget ? { boxShadow: "0 -2px 0 0 var(--orange)" } : undefined}
      >
        <AgentRow
          agent={agent}
          isActive={key === active}
          activeThinking={key === active ? activeThinking : undefined}
          mini={mini}
          onSelect={() => onSelect(key)}
          onMenuOpen={(e) => openAgentMenu(agent.baseUrl, e)}
        />
      </div>
    );
  }

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
        {/* Ungrouped direct agents — draggable */}
        {ungroupedAgents.length > 0 && (
          <div
            className="mb-1.5"
            onDragOver={handleUngroupedDragOver}
            onDrop={handleUngroupedDrop}
          >
            {ungroupedAgents.map(({ agent, globalIndex }, i) =>
              renderAgentItem(agent, globalIndex, null, i)
            )}
          </div>
        )}

        {/* Agent groups */}
        {orderedGroups.map((group, groupIdx) => {
          const groupAgents = resolveGroupAgents(group);
          // Keep empty groups visible

          const isGroupDropTarget = dropGroupIndex === groupIdx && dragGroupIndex !== null && dragGroupIndex !== groupIdx;

          return (
            <div
              key={group.id}
              className={`mb-1.5 ${isGroupDropTarget ? "border-t-2 border-[var(--accent)]" : "border-t-2 border-transparent"}`}
              draggable={!mini}
              onDragStart={(e) => {
                if (dragAgentUrl) return; // Don't drag group when dragging agent
                e.stopPropagation();
                setDragGroupIndex(groupIdx);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                e.preventDefault();
                if (dragAgentUrl) {
                  handleGroupDragOver(group.id, groupAgents.length, e);
                } else if (dragGroupIndex !== null) {
                  setDropGroupIndex(groupIdx);
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragAgentUrl) {
                  handleGroupDrop(group.id, e);
                } else if (dragGroupIndex !== null && dragGroupIndex !== groupIdx) {
                  reorderGroups(dragGroupIndex, groupIdx);
                }
                setDragGroupIndex(null);
                setDropGroupIndex(null);
              }}
              onDragEnd={() => { setDragGroupIndex(null); setDropGroupIndex(null); }}
            >
              {/* Group header */}
              <div className="flex items-center justify-between px-2 mb-1 group/header">
                <button
                  onClick={() => toggleGroupCollapsed(group.id)}
                  className="flex items-center gap-1 text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-semibold truncate cursor-pointer hover:text-[var(--text-dim)] transition-colors"
                >
                  <span className={`inline-block text-xs transition-transform duration-150 ${group.collapsed ? "" : "rotate-90"}`}>
                    ▸
                  </span>
                  <span>
                    {group.name}
                    {group.collapsed ? ` (${groupAgents.length})` : ""}
                  </span>
                </button>
                {!mini && (
                  <button
                    onClick={(e) => openGroupMenu(group.id, e)}
                    className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-dim)] opacity-0 group-hover/header:opacity-100 transition-opacity cursor-pointer"
                    title="Group options"
                  >
                    ⋯
                  </button>
                )}
              </div>

              {/* Group agents */}
              {!group.collapsed && (groupAgents.length > 0
                ? groupAgents.map((agent, i) => {
                    const globalIndex = directAgents.find(d => d.agent.baseUrl === agent.baseUrl)?.globalIndex ?? 0;
                    return renderAgentItem(agent, globalIndex, group.id, i);
                  })
                : <div className="px-3 py-1.5 text-[10px] text-[var(--text-muted)] italic">No agents</div>
              )}
            </div>
          );
        })}

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

      {/* Agent context menu */}
      {agentMenu && (
        <ContextMenu
          pos={agentMenu.pos}
          items={[
            {
              label: "Move to group",
              onClick: () => {
                setMoveToGroupMenu({
                  agentUrl: agentMenu.agentUrl,
                  currentGroupId: findGroupForAgent(agentMenu.agentUrl),
                  pos: agentMenu.pos,
                });
                setAgentMenu(null);
              },
            },
            {
              label: "Remove",
              danger: true,
              onClick: () => onRemoveAgent?.(agentMenu.agentUrl),
            },
          ]}
          onClose={() => setAgentMenu(null)}
        />
      )}

      {/* Move to group submenu */}
      {moveToGroupMenu && (
        <MoveToGroupMenu
          pos={moveToGroupMenu.pos}
          groups={agentGroups}
          currentGroupId={moveToGroupMenu.currentGroupId}
          onMoveToGroup={(groupId) => moveAgentToGroup(moveToGroupMenu.agentUrl, groupId)}
          onNewGroup={() => {
            setGroupModal({ mode: "create", agentUrl: moveToGroupMenu.agentUrl });
            setGroupModalName("");
          }}
          onMoveToUngrouped={() => removeAgentFromGroup(moveToGroupMenu.agentUrl)}
          onClose={() => setMoveToGroupMenu(null)}
        />
      )}

      {/* Group context menu */}
      {groupMenu && (
        <ContextMenu
          pos={groupMenu.pos}
          items={[
            {
              label: "Rename",
              onClick: () => {
                const group = agentGroups.find(g => g.id === groupMenu.groupId);
                setGroupModal({ mode: "rename", groupId: groupMenu.groupId });
                setGroupModalName(group?.name ?? "");
              },
            },
            {
              label: "Delete",
              danger: true,
              onClick: () => deleteGroup(groupMenu.groupId),
            },
          ]}
          onClose={() => setGroupMenu(null)}
        />
      )}

      {/* Group name modal (create / rename) */}
      {groupModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.5)" }}
          onClick={() => { setGroupModal(null); setGroupModalName(""); }}
        >
          <div className="bg-[var(--bg)] border border-[var(--border)] rounded-lg w-[280px] p-4" onClick={(e) => e.stopPropagation()}>
            <p className="text-xs text-[var(--text-dim)] mb-2 font-semibold">
              {groupModal.mode === "create" ? "New group" : "Rename group"}
            </p>
            <input
              autoFocus
              type="text"
              placeholder="Group name"
              value={groupModalName}
              onChange={(e) => setGroupModalName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleGroupModalSubmit(); if (e.key === "Escape") { setGroupModal(null); setGroupModalName(""); } }}
              className="w-full px-3 py-2 text-sm bg-[var(--bg-sidebar)] border border-[var(--border)] rounded-md mb-3 text-[var(--text)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--text-muted)] transition-colors"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setGroupModal(null); setGroupModalName(""); }}
                className="text-xs px-3 py-1.5 rounded text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleGroupModalSubmit}
                disabled={!groupModalName.trim()}
                className="text-xs px-3 py-1.5 rounded bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--text)] cursor-pointer disabled:opacity-30"
              >
                {groupModal.mode === "create" ? "Create" : "Rename"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add modal — agent or server */}
      {showAddModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.5)" }}
          onClick={() => setShowAddModal(false)}
        >
          <div className="bg-[var(--bg)] border border-[var(--border)] rounded-lg w-[340px]" onClick={(e) => e.stopPropagation()}>
            {/* Tab switcher */}
            <div className="flex gap-4 px-4 pt-3 border-b border-[var(--border)]">
              {(["agent", "server"] as AddMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setAddMode(mode)}
                  className={`text-xs pb-2 transition-colors cursor-pointer border-b -mb-px ${
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
              <p className="text-xs text-[var(--text-muted)] mb-3 leading-relaxed">
                {addMode === "agent"
                  ? "Connect directly to a running agent."
                  : "Connect to a kern proxy managing multiple agents."}
              </p>

              <label className="block text-xs text-[var(--text-muted)] mb-1">
                {addMode === "agent" ? "URL" : "Server URL"}
              </label>
              <input
                type="text"
                placeholder={addMode === "agent" ? "host:4100" : "host:8080"}
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[var(--bg-sidebar)] border border-[var(--border)] rounded-md mb-3 text-[var(--text)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--text-muted)] transition-colors"
                autoFocus
              />

              <label className="block text-xs text-[var(--text-muted)] mb-1">Token</label>
              <input
                type="password"
                placeholder={addMode === "agent" ? "KERN_AUTH_TOKEN" : "KERN_WEB_TOKEN"}
                value={newToken}
                onChange={(e) => setNewToken(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[var(--bg-sidebar)] border border-[var(--border)] rounded-md mb-4 text-[var(--text)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--text-muted)] transition-colors"
                onKeyDown={(e) => { if (e.key === "Enter" && newUrl.trim()) handleAdd(); }}
              />

              <button
                onClick={handleAdd}
                disabled={!newUrl.trim()}
                className="w-full text-sm py-2 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] transition-colors cursor-pointer text-[var(--text-dim)] hover:text-[var(--text)] hover:border-[var(--text-muted)] disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Connect
              </button>

              <p className="text-[11px] text-[var(--text-muted)] mt-3 text-center">
                Don&apos;t have an agent? <a href="https://kern-ai.com/docs/get-started" target="_blank" rel="noopener" className="text-[var(--text-dim)] hover:text-[var(--text)] underline">Get started</a>
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
