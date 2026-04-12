"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import type { AgentInfo } from "../lib/types";
import { useStore } from "../lib/store";
import * as api from "../lib/api";

export function useAgents() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [active, setActiveState] = useState<string | null>(null);
  const activeRef = useRef<string | null>(null);
  activeRef.current = active;

  // Read connections from store with shallow equality to avoid spurious rerenders
  const servers = useStore(useShallow((s) => s.connections.servers));
  const directs = useStore(useShallow((s) => s.connections.agents));
  const storeAddServer = useStore((s) => s.addServer);
  const storeRemoveServer = useStore((s) => s.removeServer);
  const storeAddAgent = useStore((s) => s.addAgent);
  const storeRemoveAgent = useStore((s) => s.removeAgent);
  const storeReorder = useStore((s) => s.reorderAgents);
  const storeUpdateName = useStore((s) => s.updateAgentName);

  const discover = useCallback(async () => {
    const proxyAgents: AgentInfo[] = [];

    // Discover from proxy servers
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

    // Discover direct agents (order preserved from store array)
    const directList: AgentInfo[] = [];
    for (const d of directs) {
      const status = await api.pingAgent(d.url, d.token);
      let name: string;
      if (status?.name) {
        name = status.name;
        // Cache name in store for offline fallback
        if (name !== d.name) storeUpdateName(d.url, name);
      } else {
        // Offline — use cached name or fall back to hostname
        name = d.name || new URL(d.url).hostname;
      }
      directList.push({
        name,
        running: status !== null,
        token: d.token,
        baseUrl: d.url,
      });
    }

    // Order: direct agents → proxy servers
    const all = [...directList, ...proxyAgents];
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
  }, [servers, directs]);

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

  // Server management — store update triggers discover via useEffect deps
  const addServer = useCallback((url: string, token: string) => {
    storeAddServer(url, token);
  }, [storeAddServer]);

  const removeServer = useCallback((url: string) => {
    storeRemoveServer(url);
    setAgents((prev) => prev.filter((a) => !a.baseUrl.startsWith(url)));
  }, [storeRemoveServer]);

  // Direct agent management — store update triggers discover via useEffect deps
  const addDirectAgent = useCallback((url: string, token: string) => {
    storeAddAgent(url, token);
  }, [storeAddAgent]);

  const removeDirectAgent = useCallback((url: string) => {
    storeRemoveAgent(url);
    setAgents((prev) => prev.filter((a) => a.baseUrl !== url));
  }, [storeRemoveAgent]);

  const reorder = useCallback((fromIndex: number, toIndex: number) => {
    // Reorder in store (persistent)
    storeReorder(fromIndex, toIndex);
    // Reorder in local state (immediate UI update)
    setAgents((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, [storeReorder]);

  const activeAgent = agents.find((a) => a.baseUrl === active) ?? null;

  return { agents, activeAgent, active, setActive, addServer, removeServer, addDirectAgent, removeDirectAgent, reorder, refresh: discover };
}

/** Stable key for an agent — baseUrl is unique */
export function agentKey(agent: AgentInfo): string {
  return agent.baseUrl;
}
