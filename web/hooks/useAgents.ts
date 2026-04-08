"use client";

import { useState, useEffect, useCallback } from "react";
import type { Agent } from "../lib/types";
import * as api from "../lib/api";

export function useAgents(token: string | null) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [active, setActiveState] = useState<string | null>(null);

  const discover = useCallback(async () => {
    if (!token) return;
    try {
      const found = await api.fetchAgents(token);
      setAgents(found);
      // Auto-select first running agent if none active
      if (!active) {
        const running = found.find((a) => a.running);
        if (running) setActiveState(running.name);
      }
    } catch {
      /* ignore */
    }
  }, [token, active]);

  useEffect(() => {
    discover();
  }, [discover]);

  const setActive = useCallback((name: string) => {
    setActiveState(name);
    sessionStorage.setItem("kern_active_agent", name);
  }, []);

  // Restore from session storage
  useEffect(() => {
    const stored = sessionStorage.getItem("kern_active_agent");
    if (stored) setActiveState(stored);
  }, []);

  const activeAgent = agents.find((a) => a.name === active) || null;

  return { agents, activeAgent, setActive, refresh: discover };
}
