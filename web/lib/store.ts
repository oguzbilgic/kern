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
}

interface UIState {
  sidebarMini: boolean;
  pinnedStats: string[];
  activeDashboard: string | null;
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

  // UI state
  ui: UIState;
  setSidebarMini: (mini: boolean) => void;
  togglePin: (key: string) => void;
  setActiveDashboard: (name: string | null) => void;
}

const PREFS_DEFAULTS: Preferences = {
  chatLayout: "flat",
  coloredTools: true,
  peekLastTool: false,
  showTools: false,
  syntaxTheme: "github-dark-dimmed",
};

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

      // UI state
      ui: { sidebarMini: false, pinnedStats: [], activeDashboard: null },
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
    }),
    {
      name: "kern",
      version: 1,
      migrate: (persisted: unknown, version: number) => {
        const state = persisted as Record<string, unknown>;
        if (version === 0) {
          // Read legacy fragmented keys
          try {
            const oldPrefs = JSON.parse(localStorage.getItem("kern-prefs") || "{}");
            const oldTheme = localStorage.getItem("kern-hljs-theme");
            const oldServers = JSON.parse(localStorage.getItem("kern-servers") || "[]");
            const oldAgents = JSON.parse(localStorage.getItem("kern-agents") || "[]");
            const oldMini = localStorage.getItem("kern-sidebar-mini") === "true";
            const oldPinned = JSON.parse(localStorage.getItem("kern-pinned-stats") || "[]");
            const oldDashboard = localStorage.getItem("kern-active-dashboard");

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

            state.prefs = { ...PREFS_DEFAULTS, ...oldPrefs };
            if (oldTheme) (state.prefs as Preferences).syntaxTheme = oldTheme;

            state.connections = { servers: oldServers, agents };
            state.ui = { sidebarMini: oldMini, pinnedStats: oldPinned, activeDashboard: oldDashboard };

            // Clean up legacy keys
            const legacyKeys = [
              "kern-prefs", "kern-hljs-theme", "kern-servers", "kern-agents",
              "kern-agent-order", "kern-sidebar-mini", "kern-pinned-stats", "kern-active-dashboard",
            ];
            for (const k of legacyKeys) localStorage.removeItem(k);
          } catch { /* ignore migration errors — defaults will apply */ }
        }
        return state as unknown as KernStore;
      },
      partialize: (state) => ({
        prefs: state.prefs,
        connections: state.connections,
        ui: state.ui,
      }),
    },
  ),
);
