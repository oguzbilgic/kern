"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { AgentInfo, ServerConfig, DirectAgent } from "../lib/types";
import * as api from "../lib/api";

/** Apply saved order from localStorage, appending any new agents at the end */
function applyOrder(agents: AgentInfo[]): AgentInfo[] {
  try {
    const stored = localStorage.getItem("kern-agent-order");
    if (!stored) return agents;
    const order: string[] = JSON.parse(stored);
    const map = new Map(agents.map((a) => [a.baseUrl, a]));
    const ordered: AgentInfo[] = [];
    for (const url of order) {
      const agent = map.get(url);
      if (agent) {
        ordered.push(agent);
        map.delete(url);
      }
    }
    // Append agents not in saved order
    for (const agent of map.values()) ordered.push(agent);
    return ordered;
  } catch {
    return agents;
  }
}

export function useAgents() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [active, setActiveState] = useState<string | null>(null);
  const activeRef = useRef<string | null>(null);
  activeRef.current = active;

  // Get proxy servers from localStorage
  const getServers = useCallback((): ServerConfig[] => {
    try {
      const stored = localStorage.getItem("kern-servers");
      if (stored) return JSON.parse(stored);
    } catch { /* ignore */ }
    return [];
  }, []);

  // Get direct agents from localStorage
  const getDirectAgents = useCallback((): DirectAgent[] => {
    try {
      const stored = localStorage.getItem("kern-agents");
      if (stored) return JSON.parse(stored);
    } catch { /* ignore */ }
    return [];
  }, []);

  const discover = useCallback(async () => {
    const proxyAgents: AgentInfo[] = [];

    // Discover from proxy servers
    const servers = getServers();
    for (const server of servers) {
      try {
        const raw = await api.fetchAgents(server.url, server.token);
        for (const a of raw) {
          proxyAgents.push({
            name: a.name,
            running: a.running,
            token: server.token,
            baseUrl: `${server.url}/api/agents/${encodeURIComponent(a.name)}`,
          });
        }
      } catch { /* ignore unreachable servers */ }
    }

    // Discover direct agents
    const directList: AgentInfo[] = [];
    const directs = getDirectAgents();
    for (const d of directs) {
      const status = await api.pingAgent(d.url, d.token);
      directList.push({
        name: status?.name || new URL(d.url).hostname,
        running: status !== null,
        token: d.token,
        baseUrl: d.url,
      });
    }

    // Order: direct agents → proxy servers, then apply saved order
    const all = applyOrder([...directList, ...proxyAgents]);
    setAgents(all);

    // Auto-select first running agent if none active
    if (!activeRef.current) {
      const stored = sessionStorage.getItem("kern_active_agent");
      if (stored && all.some((a) => a.baseUrl === stored)) {
        setActiveState(stored);
      } else {
        const first = all.find((a) => a.running);
        if (first) setActiveState(first.baseUrl);
      }
    }
  }, [getServers, getDirectAgents]);

  // Discover on mount and periodically
  useEffect(() => {
    discover();
    const iv = setInterval(discover, 30_000);
    return () => clearInterval(iv);
  }, [discover]);

  const setActive = useCallback((key: string) => {
    setActiveState(key);
    sessionStorage.setItem("kern_active_agent", key);
  }, []);

  // Server management (proxy)
  const addServer = useCallback((url: string, serverToken: string) => {
    const servers = getServers();
    if (servers.some((s) => s.url === url)) return;
    servers.push({ url, token: serverToken });
    localStorage.setItem("kern-servers", JSON.stringify(servers));
    discover();
  }, [getServers, discover]);

  const removeServer = useCallback((url: string) => {
    const servers = getServers().filter((s) => s.url !== url);
    localStorage.setItem("kern-servers", JSON.stringify(servers));
    setAgents((prev) => prev.filter((a) => !a.baseUrl.startsWith(url)));
  }, [getServers]);

  // Direct agent management
  const addDirectAgent = useCallback((url: string, agentToken: string) => {
    const directs = getDirectAgents();
    if (directs.some((d) => d.url === url)) return;
    directs.push({ url, token: agentToken });
    localStorage.setItem("kern-agents", JSON.stringify(directs));
    discover();
  }, [getDirectAgents, discover]);

  const removeDirectAgent = useCallback((url: string) => {
    const directs = getDirectAgents().filter((d) => d.url !== url);
    localStorage.setItem("kern-agents", JSON.stringify(directs));
    setAgents((prev) => prev.filter((a) => a.baseUrl !== url));
  }, [getDirectAgents]);

  const reorder = useCallback((fromIndex: number, toIndex: number) => {
    setAgents((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      localStorage.setItem("kern-agent-order", JSON.stringify(next.map((a) => a.baseUrl)));
      return next;
    });
  }, []);

  const activeAgent = agents.find((a) => a.baseUrl === active) ?? null;

  return { agents, activeAgent, active, setActive, addServer, removeServer, addDirectAgent, removeDirectAgent, reorder, refresh: discover };
}

/** Stable key for an agent — baseUrl is unique */
export function agentKey(agent: AgentInfo): string {
  return agent.baseUrl;
}
