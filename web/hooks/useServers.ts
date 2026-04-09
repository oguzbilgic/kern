"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { AgentInfo, ServerConfig } from "../lib/types";
import * as api from "../lib/api";

export function useServers(token: string | null) {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [active, setActiveState] = useState<string | null>(null);
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
    const all: AgentInfo[] = [];

    for (const server of servers) {
      try {
        const raw = await api.fetchAgents(server.token, server.url);
        const base = server.url || "";
        for (const a of raw) {
          all.push({
            name: a.name,
            running: a.running,
            baseUrl: `${base}/api/agents/${encodeURIComponent(a.name)}`,
            token: server.token,
          });
        }
      } catch { /* ignore unreachable servers */ }
    }

    setAgents(all);

    // Auto-select first running agent if none active
    if (!activeRef.current) {
      const stored = sessionStorage.getItem("kern_active_agent");
      if (stored && all.some((a) => agentKey(a) === stored)) {
        setActiveState(stored);
      } else {
        const first = all.find((a) => a.running);
        if (first) setActiveState(agentKey(first));
      }
    }
  }, [token, getServers]);

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
    setAgents((prev) => prev.filter((a) => !a.baseUrl.startsWith(url)));
  }, [getServers]);

  const activeAgent = agents.find((a) => agentKey(a) === active) ?? null;

  return { agents, activeAgent, active, setActive, addServer, removeServer, refresh: discover };
}

export function agentKey(agent: AgentInfo): string {
  return `${agent.baseUrl}`;
}
