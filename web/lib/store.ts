"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ChatLayout = "bubble" | "flat";

export interface Preferences {
  chatLayout: ChatLayout;
  coloredTools: boolean;
  peekLastTool: boolean;
  showTools: boolean;
  syntaxTheme: string;
}

export interface ConnectionEntry {
  url: string;
  token: string;
  name?: string;
}

export interface AgentGroup {
  id: string;
  name: string;
  agentUrls: string[];
  collapsed: boolean;
}

interface UIState {
  sidebarMini: boolean;
  pinnedStats: string[];
  activeDashboard: string | null;
  agentGroups: AgentGroup[];
  groupOrder: string[]; // group ids in display order
}

export interface KernStore {
  // Preferences
  prefs: Preferences;
  setPrefs: (partial: Partial<Preferences>) => void;

  // Connections
  connections: {
    servers: ConnectionEntry[];
    agents: ConnectionEntry[];
  };
  addServer: (url: string, token: string) => void;
  removeServer: (url: string) => void;
  addAgent: (url: string, token: string) => void;
  removeAgent: (url: string) => void;
  reorderAgents: (from: number, to: number) => void;
  updateAgentName: (url: string, name: string) => void;

  // UI state
  ui: UIState;
  setSidebarMini: (mini: boolean) => void;
  togglePin: (key: string) => void;
  setActiveDashboard: (name: string | null) => void;

  // Agent groups
  createGroup: (name: string, agentUrl?: string) => string;
  renameGroup: (groupId: string, name: string) => void;
  deleteGroup: (groupId: string) => void;
  moveAgentToGroup: (agentUrl: string, groupId: string, atIndex?: number) => void;
  removeAgentFromGroup: (agentUrl: string) => void;
  toggleGroupCollapsed: (groupId: string) => void;
  reorderGroups: (fromIndex: number, toIndex: number) => void;
  reorderAgentInGroup: (groupId: string, fromIndex: number, toIndex: number) => void;
}

const PREFS_DEFAULTS: Preferences = {
  chatLayout: "flat",
  coloredTools: true,
  peekLastTool: false,
  showTools: false,
  syntaxTheme: "github-dark-dimmed",
};

// Migrate legacy localStorage keys → single 'kern' key before Zustand loads.
// Runs once on module import. If 'kern' already exists, skip.
if (typeof window !== "undefined" && !localStorage.getItem("kern")) {
  try {
    const hasLegacy = localStorage.getItem("kern-prefs") || localStorage.getItem("kern-agents") || localStorage.getItem("kern-servers");
    if (hasLegacy) {
      const oldPrefs = JSON.parse(localStorage.getItem("kern-prefs") || "{}");
      const oldTheme = localStorage.getItem("kern-hljs-theme");
      const oldServers: ConnectionEntry[] = JSON.parse(localStorage.getItem("kern-servers") || "[]");
      const oldAgents: ConnectionEntry[] = JSON.parse(localStorage.getItem("kern-agents") || "[]");
      const oldMini = localStorage.getItem("kern-sidebar-mini") === "true";
      const oldPinned: string[] = JSON.parse(localStorage.getItem("kern-pinned-stats") || "[]");
      const oldDashboard = localStorage.getItem("kern-active-dashboard") || null;

      // Apply saved order to direct agents
      let agents: ConnectionEntry[] = oldAgents;
      try {
        const order: string[] = JSON.parse(localStorage.getItem("kern-agent-order") || "[]");
        if (order.length) {
          const map = new Map<string, ConnectionEntry>(agents.map((a) => [a.url, a]));
          const ordered: ConnectionEntry[] = [];
          for (const url of order) {
            const agent = map.get(url);
            if (agent) { ordered.push(agent); map.delete(url); }
          }
          for (const agent of map.values()) ordered.push(agent);
          agents = ordered;
        }
      } catch { /* ignore */ }

      const prefs = { ...PREFS_DEFAULTS, ...oldPrefs };
      if (oldTheme) prefs.syntaxTheme = oldTheme;

      const migrated = {
        state: {
          prefs,
          connections: { servers: oldServers, agents },
          ui: { sidebarMini: oldMini, pinnedStats: oldPinned, activeDashboard: oldDashboard },
        },
        version: 1,
      };
      localStorage.setItem("kern", JSON.stringify(migrated));

      // Clean up legacy keys
      const legacyKeys = [
        "kern-prefs", "kern-hljs-theme", "kern-servers", "kern-agents",
        "kern-agent-order", "kern-sidebar-mini", "kern-pinned-stats", "kern-active-dashboard",
        "kern-chat-layout", "kern-token",
        "kern_filters", "kern_pinned_stats", "kern_servers", "kern_sidebar_prev",
        "kern_sidebar_state", "kern_web_token",
      ];
      for (const k of legacyKeys) localStorage.removeItem(k);
    }
  } catch { /* ignore migration errors */ }
}

export const useStore = create<KernStore>()(
  persist(
    (set) => ({
      // Preferences
      prefs: { ...PREFS_DEFAULTS },
      setPrefs: (partial) =>
        set((s) => ({ prefs: { ...s.prefs, ...partial } })),

      // Connections
      connections: { servers: [], agents: [] },
      addServer: (url, token) =>
        set((s) => {
          if (s.connections.servers.some((sv) => sv.url === url)) return s;
          return { connections: { ...s.connections, servers: [...s.connections.servers, { url, token }] } };
        }),
      removeServer: (url) =>
        set((s) => ({
          connections: { ...s.connections, servers: s.connections.servers.filter((sv) => sv.url !== url) },
        })),
      addAgent: (url, token) =>
        set((s) => {
          if (s.connections.agents.some((a) => a.url === url)) return s;
          return { connections: { ...s.connections, agents: [...s.connections.agents, { url, token }] } };
        }),
      removeAgent: (url) =>
        set((s) => ({
          connections: { ...s.connections, agents: s.connections.agents.filter((a) => a.url !== url) },
        })),
      reorderAgents: (from, to) =>
        set((s) => {
          const next = [...s.connections.agents];
          const [moved] = next.splice(from, 1);
          next.splice(to, 0, moved);
          return { connections: { ...s.connections, agents: next } };
        }),
      updateAgentName: (url, name) =>
        set((s) => ({
          connections: {
            ...s.connections,
            agents: s.connections.agents.map((a) =>
              a.url === url ? { ...a, name } : a
            ),
          },
        })),

      // UI state
      ui: { sidebarMini: false, pinnedStats: [], activeDashboard: null, agentGroups: [], groupOrder: [] },
      setSidebarMini: (mini) =>
        set((s) => ({ ui: { ...s.ui, sidebarMini: mini } })),
      togglePin: (key) =>
        set((s) => {
          const pins = new Set(s.ui.pinnedStats);
          if (pins.has(key)) pins.delete(key);
          else pins.add(key);
          return { ui: { ...s.ui, pinnedStats: [...pins] } };
        }),
      setActiveDashboard: (name) =>
        set((s) => ({ ui: { ...s.ui, activeDashboard: name } })),

      // Agent groups
      createGroup: (name, agentUrl) => {
        const id = Math.random().toString(36).slice(2) + Date.now().toString(36);
        set((s) => {
          const newGroup: AgentGroup = {
            id,
            name,
            agentUrls: agentUrl ? [agentUrl] : [],
            collapsed: false,
          };
          // Remove agent from any existing group if provided
          const existing = s.ui.agentGroups ?? [];
          const groups = agentUrl
            ? existing.map((g) => ({
                ...g,
                agentUrls: g.agentUrls.filter((u) => u !== agentUrl),
              }))
            : [...existing];
          return {
            ui: {
              ...s.ui,
              agentGroups: [...groups, newGroup],
              groupOrder: [...(s.ui.groupOrder ?? []), id],
            },
          };
        });
        return id;
      },
      renameGroup: (groupId, name) =>
        set((s) => ({
          ui: {
            ...s.ui,
            agentGroups: (s.ui.agentGroups ?? []).map((g) =>
              g.id === groupId ? { ...g, name } : g
            ),
          },
        })),
      deleteGroup: (groupId) =>
        set((s) => ({
          ui: {
            ...s.ui,
            agentGroups: (s.ui.agentGroups ?? []).filter((g) => g.id !== groupId),
            groupOrder: (s.ui.groupOrder ?? []).filter((id) => id !== groupId),
          },
        })),
      moveAgentToGroup: (agentUrl, groupId, atIndex) =>
        set((s) => {
          const updated = (s.ui.agentGroups ?? []).map((g) => {
            const filtered = g.agentUrls.filter((u) => u !== agentUrl);
            if (g.id === groupId) {
              if (atIndex !== undefined && atIndex >= 0 && atIndex <= filtered.length) {
                const urls = [...filtered];
                urls.splice(atIndex, 0, agentUrl);
                return { ...g, agentUrls: urls };
              }
              return { ...g, agentUrls: [...filtered, agentUrl] };
            }
            return { ...g, agentUrls: filtered };
          });
          return { ui: { ...s.ui, agentGroups: updated } };
        }),
      removeAgentFromGroup: (agentUrl) =>
        set((s) => ({
          ui: {
            ...s.ui,
            agentGroups: (s.ui.agentGroups ?? []).map((g) => ({
              ...g,
              agentUrls: g.agentUrls.filter((u) => u !== agentUrl),
            })),
          },
        })),
      toggleGroupCollapsed: (groupId) =>
        set((s) => ({
          ui: {
            ...s.ui,
            agentGroups: (s.ui.agentGroups ?? []).map((g) =>
              g.id === groupId ? { ...g, collapsed: !g.collapsed } : g
            ),
          },
        })),
      reorderGroups: (fromIndex, toIndex) =>
        set((s) => {
          const next = [...(s.ui.groupOrder ?? [])];
          const [moved] = next.splice(fromIndex, 1);
          next.splice(toIndex, 0, moved);
          return { ui: { ...s.ui, groupOrder: next } };
        }),
      reorderAgentInGroup: (groupId, fromIndex, toIndex) =>
        set((s) => ({
          ui: {
            ...s.ui,
            agentGroups: (s.ui.agentGroups ?? []).map((g) => {
              if (g.id !== groupId) return g;
              const urls = [...g.agentUrls];
              const [moved] = urls.splice(fromIndex, 1);
              urls.splice(toIndex, 0, moved);
              return { ...g, agentUrls: urls };
            }),
          },
        })),
    }),
    {
      name: "kern",
      version: 1,
      partialize: (state) => ({
        prefs: state.prefs,
        connections: state.connections,
        ui: state.ui,
      }),
      merge: (persisted, current) => {
        const p = persisted as Partial<KernStore>;
        return {
          ...current,
          ...p,
          ui: { ...current.ui, ...(p.ui ?? {}) },
        };
      },
    },
  ),
);
