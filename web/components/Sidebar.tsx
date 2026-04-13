"use client";

import { useState, useEffect, useRef } from "react";
import type { AgentInfo } from "../lib/types";
import { useAgent } from "../hooks/useAgent";
import { agentKey } from "../hooks/useAgents";
import { renderPluginSidebars } from "../plugins/registry";
import { avatarColor } from "../lib/colors";
import { useStore } from "../lib/store";

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
        <div className="flex-1 min-w-0">
          <span className="truncate whitespace-nowrap">{agent.name}</span>
        </div>
      </button>
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

/* ── Dropdown menu ────────────────────────────────────────────────── */

interface MenuEntry { label: string; onClick: () => void; danger?: boolean; separator?: boolean }

function DropdownMenu({ pos, items, onClose }: { pos: { x: number; y: number }; items: MenuEntry[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);

  return (
    <div ref={ref} className="fixed z-[100] bg-[var(--bg)] border border-[var(--border)] rounded-lg shadow-lg py-1 min-w-[160px]" style={{ top: pos.y, left: pos.x }}>
      {items.map((item, i) =>
        item.separator ? <div key={i} className="border-t border-[var(--border)] my-1" /> : (
          <button
            key={i}
            onClick={() => { item.onClick(); onClose(); }}
            className={`w-full text-left text-xs px-3 py-1.5 transition-colors cursor-pointer ${
              item.danger ? "text-red-400 hover:bg-red-400/10" : "text-[var(--text-dim)] hover:bg-white/[0.06]"
            }`}
          >
            {item.label}
          </button>
        )
      )}
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
  // Add modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [addMode, setAddMode] = useState<AddMode>("agent");
  const [newUrl, setNewUrl] = useState("");
  const [newToken, setNewToken] = useState("");

  // Menu state — one menu at a time
  const [menu, setMenu] = useState<{ pos: { x: number; y: number }; items: MenuEntry[] } | null>(null);

  // Group name modal (create/rename)
  const [groupModal, setGroupModal] = useState<{ mode: "create"; agentUrl: string } | { mode: "rename"; groupId: string } | null>(null);
  const [groupModalName, setGroupModalName] = useState("");

  // Agent drag state
  const [dragUrl, setDragUrl] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ groupId: string | null; index: number } | null>(null);

  // Store
  const mini = useStore((s) => s.ui.sidebarMini);
  const setSidebarMini = useStore((s) => s.setSidebarMini);
  const [userSet, setUserSet] = useState(false);
  const agentGroups = useStore((s) => s.ui.agentGroups);
  const groupOrder = useStore((s) => s.ui.groupOrder);
  const { createGroup, renameGroup, deleteGroup, moveAgentToGroup, removeAgentFromGroup, toggleGroupCollapsed, reorderAgentInGroup } = useStore();

  // Mini/full toggle
  function toggleMini() { setUserSet(true); setSidebarMini(!mini); }

  useEffect(() => {
    function check() {
      if (window.innerWidth < 768) { setSidebarMini(true); setUserSet(false); }
      else if (window.innerWidth >= 1024 && !userSet) setSidebarMini(false);
    }
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [userSet]);

  // Split agents into proxy groups and direct agents
  const proxyGroups = new Map<string, AgentInfo[]>();
  const directAgents: { agent: AgentInfo; globalIndex: number }[] = [];
  for (let i = 0; i < agents.length; i++) {
    const a = agents[i];
    const pi = a.baseUrl.indexOf("/api/agents/");
    if (pi >= 0) {
      const server = a.baseUrl.slice(0, pi);
      if (!proxyGroups.has(server)) proxyGroups.set(server, []);
      proxyGroups.get(server)!.push(a);
    } else {
      directAgents.push({ agent: a, globalIndex: i });
    }
  }

  const directMap = new Map(directAgents.map(({ agent }) => [agent.baseUrl, agent]));
  const groupedUrls = new Set(agentGroups.flatMap((g) => g.agentUrls));
  const ungrouped = directAgents.filter(({ agent }) => !groupedUrls.has(agent.baseUrl));

  // Ordered groups
  const groupMap = new Map(agentGroups.map((g) => [g.id, g]));
  const orderedGroups = [
    ...groupOrder.map((id) => groupMap.get(id)).filter(Boolean),
    ...agentGroups.filter((g) => !groupOrder.includes(g.id)),
  ] as typeof agentGroups;

  function resolveAgents(urls: string[]) {
    return urls.map((u) => directMap.get(u)).filter(Boolean) as AgentInfo[];
  }

  function findGroup(url: string): string | null {
    return agentGroups.find((g) => g.agentUrls.includes(url))?.id ?? null;
  }

  // Drag-drop
  function handleDrop() {
    if (!dragUrl || !dropTarget) { setDragUrl(null); setDropTarget(null); return; }
    const from = findGroup(dragUrl);
    const { groupId: to, index } = dropTarget;

    if (to === null) {
      if (from) removeAgentFromGroup(dragUrl);
      else {
        const fromIdx = ungrouped.findIndex((u) => u.agent.baseUrl === dragUrl);
        const toIdx = Math.min(index, ungrouped.length - 1);
        if (fromIdx >= 0 && toIdx >= 0 && fromIdx !== toIdx) onReorder?.(ungrouped[fromIdx].globalIndex, ungrouped[toIdx].globalIndex);
      }
    } else if (from === to) {
      const fromIdx = agentGroups.find((g) => g.id === to)?.agentUrls.indexOf(dragUrl) ?? -1;
      if (fromIdx >= 0 && fromIdx !== index) reorderAgentInGroup(to, fromIdx, index);
    } else {
      moveAgentToGroup(dragUrl, to, index);
    }
    setDragUrl(null);
    setDropTarget(null);
  }

  // Context menus
  function agentMenuItems(url: string): MenuEntry[] {
    const currentGroup = findGroup(url);
    const moveItems: MenuEntry[] = [];
    if (currentGroup) moveItems.push({ label: "Move to ungrouped", onClick: () => removeAgentFromGroup(url) });
    for (const g of agentGroups) {
      if (g.id !== currentGroup) moveItems.push({ label: `Move to ${g.name}`, onClick: () => moveAgentToGroup(url, g.id) });
    }
    moveItems.push({ separator: true, label: "", onClick: () => {} });
    moveItems.push({ label: "New group…", onClick: () => { setGroupModal({ mode: "create", agentUrl: url }); setGroupModalName(""); } });
    return [
      ...moveItems,
      { separator: true, label: "", onClick: () => {} },
      { label: "Remove", danger: true, onClick: () => onRemoveAgent?.(url) },
    ];
  }

  function groupMenuItems(groupId: string): MenuEntry[] {
    return [
      { label: "Rename", onClick: () => { const g = agentGroups.find((g) => g.id === groupId); setGroupModal({ mode: "rename", groupId }); setGroupModalName(g?.name ?? ""); } },
      { label: "Delete group", danger: true, onClick: () => deleteGroup(groupId) },
    ];
  }

  function openMenu(pos: { x: number; y: number }, items: MenuEntry[]) {
    setMenu({ pos, items });
  }

  // Group modal submit
  function handleGroupModalSubmit() {
    const name = groupModalName.trim();
    if (!name || !groupModal) return;
    if (groupModal.mode === "create") createGroup(name, groupModal.agentUrl);
    else renameGroup(groupModal.groupId, name);
    setGroupModal(null);
    setGroupModalName("");
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
    if (addMode === "server") onAddServer?.(url, newToken.trim());
    else onAddAgent?.(url, newToken.trim());
    setNewUrl(""); setNewToken(""); setShowAddModal(false);
  }

  // Render agent row with drag
  function renderAgent(agent: AgentInfo, groupId: string | null, indexInGroup: number) {
    const key = agentKey(agent);
    const dragging = dragUrl && dragUrl !== agent.baseUrl;
    const isBefore = dragging && dropTarget?.groupId === groupId && dropTarget.index === indexInGroup;
    const isAfter = dragging && dropTarget?.groupId === groupId && dropTarget.index === indexInGroup + 1;

    return (
      <div
        key={key}
        draggable
        onDragStart={(e) => { setDragUrl(agent.baseUrl); e.dataTransfer.effectAllowed = "move"; }}
        onDragOver={(e) => {
          e.preventDefault(); e.stopPropagation();
          if (!dragUrl) return;
          const r = e.currentTarget.getBoundingClientRect();
          setDropTarget({ groupId, index: e.clientY < r.top + r.height / 2 ? indexInGroup : indexInGroup + 1 });
        }}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleDrop(); }}
        onDragEnd={() => { setDragUrl(null); setDropTarget(null); }}
        style={isBefore ? { boxShadow: "0 -2px 0 0 var(--orange)" } : isAfter ? { boxShadow: "0 2px 0 0 var(--orange)" } : undefined}
      >
        <AgentRow
          agent={agent} isActive={key === active}
          activeThinking={key === active ? activeThinking : undefined}
          mini={mini}
          onSelect={() => onSelect(key)}
          onMenuOpen={(e) => { e.preventDefault(); e.stopPropagation(); openMenu({ x: e.clientX, y: e.clientY }, agentMenuItems(agent.baseUrl)); }}
        />
      </div>
    );
  }

  const activeAgentObj = agents.find((a) => agentKey(a) === active);

  return (
    <div
      className="bg-[var(--bg-sidebar)] flex flex-col flex-shrink-0 transition-[width] duration-200 relative overflow-hidden"
      data-sidebar
      style={{ width: mini ? 75 : 200 }}
    >
      {/* Right edge toggle */}
      <div onClick={toggleMini} className="absolute top-0 right-0 w-[2px] h-full cursor-col-resize hover:bg-[var(--accent)] transition-colors duration-150 z-10" style={{ background: "var(--border)" }} title={mini ? "Expand" : "Collapse"} />

      {/* Header */}
      <div className="h-12 flex items-center border-b border-[var(--border)] px-4 whitespace-nowrap">
        <button onClick={toggleMini} className="cursor-pointer hover:opacity-80 transition-opacity">
          <span className="text-sm font-semibold">kern<span className="text-[var(--accent)]">.</span></span>
        </button>
      </div>

      {/* Agent list */}
      <div className="flex-1 overflow-y-auto p-2">
        {/* Ungrouped */}
        {ungrouped.length > 0 && (
          <div
            className="mb-1.5"
            onDragOver={(e) => { e.preventDefault(); if (dragUrl) setDropTarget({ groupId: null, index: -1 }); }}
            onDrop={(e) => { e.preventDefault(); handleDrop(); }}
          >
            {ungrouped.map(({ agent }, i) => renderAgent(agent, null, i))}
          </div>
        )}

        {/* Groups */}
        {orderedGroups.map((group) => {
          const members = resolveAgents(group.agentUrls);
          return (
            <div
              key={group.id}
              className="mb-1.5"
              onDragOver={(e) => { e.preventDefault(); if (dragUrl) setDropTarget({ groupId: group.id, index: members.length }); }}
              onDrop={(e) => { e.preventDefault(); handleDrop(); }}
            >
              <div className="flex items-center justify-between px-2 mb-1 group/header">
                <button
                  onClick={() => toggleGroupCollapsed(group.id)}
                  className="flex items-center gap-1 text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-semibold truncate cursor-pointer hover:text-[var(--text-dim)] transition-colors"
                >
                  <span className={`inline-block text-xs transition-transform duration-150 ${group.collapsed ? "" : "rotate-90"}`}>▸</span>
                  <span>{group.name}{group.collapsed ? ` (${members.length})` : ""}</span>
                </button>
                {!mini && (
                  <button
                    onClick={(e) => { e.stopPropagation(); openMenu({ x: e.clientX, y: e.clientY }, groupMenuItems(group.id)); }}
                    className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-dim)] opacity-0 group-hover/header:opacity-100 transition-opacity cursor-pointer"
                  >
                    ⋯
                  </button>
                )}
              </div>
              {!group.collapsed && (members.length > 0
                ? members.map((agent, i) => renderAgent(agent, group.id, i))
                : <div className="px-3 py-1.5 text-[10px] text-[var(--text-muted)] italic">No agents</div>
              )}
            </div>
          );
        })}

        {/* Proxy servers */}
        {Array.from(proxyGroups.entries()).map(([server, serverAgents]) => (
          <div key={server} className="mb-1.5">
            <div className="flex items-center justify-between px-2 mb-1">
              <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider truncate">{server.replace(/^https?:\/\//, "")}</span>
              <button onClick={() => onRemoveServer?.(server)} className="text-[10px] text-[var(--text-muted)] hover:text-red-400" title="Remove server">×</button>
            </div>
            {serverAgents.map((agent) => {
              const key = agentKey(agent);
              return <AgentRow key={key} agent={agent} isActive={key === active} activeThinking={key === active ? activeThinking : undefined} mini={mini} onSelect={() => onSelect(key)} />;
            })}
          </div>
        ))}

        {agents.length === 0 && (
          <div className="text-xs text-[var(--text-muted)] px-2 py-4 text-center">Add an agent to get started.</div>
        )}

        {/* Add button */}
        <button onClick={() => setShowAddModal(true)} className="flex items-center gap-2.5 w-full rounded-lg text-sm text-left transition-colors cursor-pointer p-2.5 mb-0.5 overflow-hidden hover:bg-white/[0.05]" title="Add agent or server">
          <div className="relative flex-shrink-0">
            <div className="w-10 h-10 flex items-center justify-center border border-dashed border-[var(--text-muted)]" style={{ borderRadius: "22%" }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round"><line x1="8" y1="4" x2="8" y2="12" /><line x1="4" y1="8" x2="12" y2="8" /></svg>
            </div>
          </div>
          <span className="text-[var(--text-muted)] text-xs whitespace-nowrap">Add</span>
        </button>

        {/* Plugin sidebar */}
        {renderPluginSidebars({ agents, activeAgent: activeAgentObj?.name ?? null, mini })}
      </div>

      {/* Dropdown menu */}
      {menu && <DropdownMenu pos={menu.pos} items={menu.items} onClose={() => setMenu(null)} />}

      {/* Group name modal */}
      {groupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }} onClick={() => { setGroupModal(null); setGroupModalName(""); }}>
          <div className="bg-[var(--bg)] border border-[var(--border)] rounded-lg w-[280px] p-4" onClick={(e) => e.stopPropagation()}>
            <p className="text-xs text-[var(--text-dim)] mb-2 font-semibold">{groupModal.mode === "create" ? "New group" : "Rename group"}</p>
            <input
              autoFocus type="text" placeholder="Group name" value={groupModalName}
              onChange={(e) => setGroupModalName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleGroupModalSubmit(); if (e.key === "Escape") { setGroupModal(null); setGroupModalName(""); } }}
              className="w-full px-3 py-2 text-sm bg-[var(--bg-sidebar)] border border-[var(--border)] rounded-md mb-3 text-[var(--text)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--text-muted)] transition-colors"
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setGroupModal(null); setGroupModalName(""); }} className="text-xs px-3 py-1.5 rounded text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer">Cancel</button>
              <button onClick={handleGroupModalSubmit} disabled={!groupModalName.trim()} className="text-xs px-3 py-1.5 rounded bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--text)] cursor-pointer disabled:opacity-30">
                {groupModal.mode === "create" ? "Create" : "Rename"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }} onClick={() => setShowAddModal(false)}>
          <div className="bg-[var(--bg)] border border-[var(--border)] rounded-lg w-[340px]" onClick={(e) => e.stopPropagation()}>
            <div className="flex gap-4 px-4 pt-3 border-b border-[var(--border)]">
              {(["agent", "server"] as AddMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setAddMode(mode)}
                  className={`text-xs pb-2 transition-colors cursor-pointer border-b -mb-px ${addMode === mode ? "border-[var(--text-dim)] text-[var(--text)]" : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-dim)]"}`}
                >
                  {mode === "agent" ? "Agent" : "Proxy server"}
                </button>
              ))}
            </div>
            <div className="px-4 pt-3 pb-4">
              <p className="text-xs text-[var(--text-muted)] mb-3 leading-relaxed">{addMode === "agent" ? "Connect directly to a running agent." : "Connect to a kern proxy managing multiple agents."}</p>
              <label className="block text-xs text-[var(--text-muted)] mb-1">{addMode === "agent" ? "URL" : "Server URL"}</label>
              <input type="text" placeholder={addMode === "agent" ? "host:4100" : "host:8080"} value={newUrl} onChange={(e) => setNewUrl(e.target.value)} className="w-full px-3 py-2 text-sm bg-[var(--bg-sidebar)] border border-[var(--border)] rounded-md mb-3 text-[var(--text)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--text-muted)] transition-colors" autoFocus />
              <label className="block text-xs text-[var(--text-muted)] mb-1">Token</label>
              <input type="password" placeholder={addMode === "agent" ? "KERN_AUTH_TOKEN" : "KERN_WEB_TOKEN"} value={newToken} onChange={(e) => setNewToken(e.target.value)} className="w-full px-3 py-2 text-sm bg-[var(--bg-sidebar)] border border-[var(--border)] rounded-md mb-4 text-[var(--text)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--text-muted)] transition-colors" onKeyDown={(e) => { if (e.key === "Enter" && newUrl.trim()) handleAdd(); }} />
              <button onClick={handleAdd} disabled={!newUrl.trim()} className="w-full text-sm py-2 rounded-md border border-[var(--border)] bg-[var(--bg-surface)] transition-colors cursor-pointer text-[var(--text-dim)] hover:text-[var(--text)] hover:border-[var(--text-muted)] disabled:opacity-30 disabled:cursor-not-allowed">Connect</button>
              <p className="text-[11px] text-[var(--text-muted)] mt-3 text-center">Don&apos;t have an agent? <a href="https://kern-ai.com/docs/get-started" target="_blank" rel="noopener" className="text-[var(--text-dim)] hover:text-[var(--text)] underline">Get started</a></p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
