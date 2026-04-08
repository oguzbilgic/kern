"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { Agent } from "../lib/types";
import * as api from "../lib/api";

interface ServerConfig {
  url: string;
  token: string;
}

export interface AgentState {
  agent: Agent;
  server: ServerConfig;
  online: boolean;
  thinking: boolean;
  unread: number;
}

export function useAgents(token: string | null) {
  const [agentStates, setAgentStates] = useState<Map<string, AgentState>>(new Map());
  const [active, setActiveState] = useState<string | null>(null);
  const sseRefs = useRef<Map<string, api.SSEConnection>>(new Map());
  const activeRef = useRef<string | null>(null);

  // Keep ref in sync
  activeRef.current = active;

  // Get servers: local (proxy) + any manually added
  const getServers = useCallback((): ServerConfig[] => {
    const servers: ServerConfig[] = [
      { url: "", token: token || "" }, // local proxy, relative URLs
    ];
    try {
      const stored = localStorage.getItem("kern-servers");
      if (stored) {
        const parsed: ServerConfig[] = JSON.parse(stored);
        servers.push(...parsed);
      }
    } catch { /* ignore */ }
    return servers;
  }, [token]);

  const discover = useCallback(async () => {
    if (!token) return;
    const servers = getServers();
    const newStates = new Map<string, AgentState>();

    for (const server of servers) {
      try {
        const agents = await api.fetchAgents(server.token, server.url);
        for (const agent of agents) {
          const key = server.url ? `${server.url}::${agent.name}` : agent.name;
          const existing = agentStates.get(key);
          newStates.set(key, {
            agent: { ...agent, server: server.url || "local" },
            server,
            online: existing?.online ?? agent.running,
            thinking: existing?.thinking ?? false,
            unread: existing?.unread ?? 0,
          });
        }
      } catch { /* ignore unreachable servers */ }
    }

    setAgentStates(newStates);

    // Auto-select first running agent if none active
    if (!activeRef.current) {
      const stored = sessionStorage.getItem("kern_active_agent");
      if (stored && newStates.has(stored)) {
        setActiveState(stored);
      } else {
        for (const [key, state] of newStates) {
          if (state.agent.running) {
            setActiveState(key);
            break;
          }
        }
      }
    }
  }, [token, getServers]);

  // Discover on mount and periodically
  useEffect(() => {
    discover();
    const iv = setInterval(discover, 30_000);
    return () => clearInterval(iv);
  }, [discover]);

  // Background SSE connections for all running agents
  useEffect(() => {
    if (!token) return;

    const currentKeys = new Set<string>();

    for (const [key, state] of agentStates) {
      if (!state.agent.running) continue;
      currentKeys.add(key);

      // Skip if already connected
      if (sseRefs.current.has(key)) continue;

      const conn = api.connectSSE(state.agent.name, state.server.token, {
        onEvent(ev) {
          if (ev.type === "text-delta" || ev.type === "finish") {
            setAgentStates((prev) => {
              const next = new Map(prev);
              const s = next.get(key);
              if (!s) return prev;

              if (ev.type === "text-delta" && key !== activeRef.current) {
                next.set(key, { ...s, thinking: false, unread: s.unread + (ev.text ? 1 : 0) });
              } else if (ev.type === "finish") {
                next.set(key, { ...s, thinking: false });
              }
              return next;
            });
          } else if (ev.type === "thinking") {
            setAgentStates((prev) => {
              const next = new Map(prev);
              const s = next.get(key);
              if (s) next.set(key, { ...s, thinking: true });
              return next;
            });
          }
        },
        onConnect() {
          setAgentStates((prev) => {
            const next = new Map(prev);
            const s = next.get(key);
            if (s) next.set(key, { ...s, online: true });
            return next;
          });
        },
        onDisconnect() {
          sseRefs.current.delete(key);
          setAgentStates((prev) => {
            const next = new Map(prev);
            const s = next.get(key);
            if (s) next.set(key, { ...s, online: false, thinking: false });
            return next;
          });
        },
      }, state.server.url);

      sseRefs.current.set(key, conn);
    }

    // Close SSE for agents no longer running
    for (const [key, conn] of sseRefs.current) {
      if (!currentKeys.has(key)) {
        conn.close();
        sseRefs.current.delete(key);
      }
    }
  }, [agentStates, token]);

  // Cleanup all SSE on unmount
  useEffect(() => {
    return () => {
      for (const conn of sseRefs.current.values()) conn.close();
      sseRefs.current.clear();
    };
  }, []);

  const setActive = useCallback((key: string) => {
    setActiveState(key);
    sessionStorage.setItem("kern_active_agent", key);
    // Clear unread for selected agent
    setAgentStates((prev) => {
      const next = new Map(prev);
      const s = next.get(key);
      if (s) next.set(key, { ...s, unread: 0 });
      return next;
    });
  }, []);

  // Server management
  const addServer = useCallback((url: string, serverToken: string) => {
    const servers = getServers().slice(1); // exclude local
    if (servers.some((s) => s.url === url)) return;
    servers.push({ url, token: serverToken });
    localStorage.setItem("kern-servers", JSON.stringify(servers));
    discover();
  }, [getServers, discover]);

  const removeServer = useCallback((url: string) => {
    const servers = getServers().slice(1).filter((s) => s.url !== url);
    localStorage.setItem("kern-servers", JSON.stringify(servers));
    // Remove agent states for this server
    setAgentStates((prev) => {
      const next = new Map(prev);
      for (const [key, state] of next) {
        if (state.server.url === url) next.delete(key);
      }
      return next;
    });
  }, [getServers]);

  const agents = Array.from(agentStates.values());
  const activeAgent = active ? agentStates.get(active)?.agent || null : null;
  const activeState = active ? agentStates.get(active) || null : null;

  return { agents, agentStates, activeAgent, activeState, active, setActive, addServer, removeServer, refresh: discover };
}
