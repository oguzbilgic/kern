"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { Agent, ServerConfig, AgentState, StreamEvent } from "../lib/types";
import * as api from "../lib/api";

export function useServers(token: string | null) {
  const [agentStates, setAgentStates] = useState<Map<string, AgentState>>(new Map());
  const [active, setActiveState] = useState<string | null>(null);
  const sseRefs = useRef<Map<string, api.SSEConnection>>(new Map());
  const activeRef = useRef<string | null>(null);

  activeRef.current = active;

  // Get servers: local (proxy) + manually added
  const getServers = useCallback((): ServerConfig[] => {
    const servers: ServerConfig[] = [
      { url: "", token: token || "" },
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
          newStates.set(key, {
            agent: { ...agent, server: server.url || "local" },
            server,
            online: agent.running,
            thinking: false,
            unread: 0,
          });
        }
      } catch { /* ignore unreachable servers */ }
    }

    // Merge with existing to preserve runtime flags
    setAgentStates((prev) => {
      const merged = new Map<string, AgentState>();
      for (const [key, state] of newStates) {
        const existing = prev.get(key);
        merged.set(key, existing
          ? { ...existing, agent: state.agent, server: state.server }
          : state
        );
      }
      return merged;
    });

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
      if (sseRefs.current.has(key)) continue;

      const IDLE_TIMEOUT = 15 * 60 * 1000;
      let idleTimer: ReturnType<typeof setTimeout> | null = null;

      const resetIdle = () => {
        if (idleTimer) clearTimeout(idleTimer);
        if (key !== activeRef.current) {
          idleTimer = setTimeout(() => {
            conn.close();
            sseRefs.current.delete(key);
          }, IDLE_TIMEOUT);
        }
      };

      const updateAgent = (updater: (s: AgentState) => AgentState) => {
        setAgentStates((prev) => {
          const s = prev.get(key);
          if (!s) return prev;
          const next = new Map(prev);
          next.set(key, updater(s));
          return next;
        });
      };

      const conn = api.connectSSE(state.agent.name, state.server.token, {
        onEvent(ev: StreamEvent) {
          resetIdle();
          if (ev.type === "thinking" || ev.type === "text-delta") {
            updateAgent((s) => ({ ...s, thinking: true }));
          } else if (ev.type === "finish") {
            updateAgent((s) => ({
              ...s,
              thinking: false,
              unread: key !== activeRef.current ? s.unread + 1 : s.unread,
            }));
          }
        },
        onConnect() {
          resetIdle();
          updateAgent((s) => ({ ...s, online: true }));
        },
        onDisconnect() {
          if (idleTimer) clearTimeout(idleTimer);
          sseRefs.current.delete(key);
          updateAgent((s) => ({ ...s, online: false, thinking: false }));
        },
      }, state.server.url);

      resetIdle();
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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const conn of sseRefs.current.values()) conn.close();
      sseRefs.current.clear();
    };
  }, []);

  const setActive = useCallback((key: string) => {
    setActiveState(key);
    sessionStorage.setItem("kern_active_agent", key);
    setAgentStates((prev) => {
      const s = prev.get(key);
      if (!s) return prev;
      const next = new Map(prev);
      next.set(key, { ...s, unread: 0 });
      return next;
    });
  }, []);

  // Server management
  const addServer = useCallback((url: string, serverToken: string) => {
    const servers = getServers().slice(1);
    if (servers.some((s) => s.url === url)) return;
    servers.push({ url, token: serverToken });
    localStorage.setItem("kern-servers", JSON.stringify(servers));
    discover();
  }, [getServers, discover]);

  const removeServer = useCallback((url: string) => {
    const servers = getServers().slice(1).filter((s) => s.url !== url);
    localStorage.setItem("kern-servers", JSON.stringify(servers));
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

  return { agents, activeAgent, activeState, active, setActive, addServer, removeServer, refresh: discover };
}
