"use client";

import { useState, useCallback, useEffect } from "react";
import type { AgentInfo } from "../../lib/types";
import type { DashboardInfo } from "./index";
import { fetchDashboards, loadDashboardHtml } from "./index";

interface DashboardStore {
  allDashboards: DashboardInfo[];
  activeDashboard: string | null;
  dashboardList: string[];
  panelHtml: { html: string; title: string; dashboard?: string } | null;
  activeAgent: AgentInfo | null;
  openPanel: (html: string, title: string, dashboard?: string) => void;
  closePanel: () => void;
  loadAndOpen: (name: string, agentName: string, serverUrl: string, token: string) => void;
}

// Singleton store reference so plugin definition can access state without React context
let _store: DashboardStore | null = null;

export function getDashboardStore(): DashboardStore | null {
  return _store;
}

/**
 * React hook that owns all dashboard state.
 * Call once at the app root. Exposes state to plugin via singleton.
 */
export function useDashboards(agents: AgentInfo[], activeAgent: AgentInfo | null): DashboardStore {
  const [panelHtml, setPanelHtml] = useState<{ html: string; title: string; dashboard?: string } | null>(null);
  const [allDashboards, setAllDashboards] = useState<DashboardInfo[]>([]);
  const [activeDashboard, setActiveDashboard] = useState<string | null>(null);

  // Fetch dashboards from all running agents
  useEffect(() => {
    if (!agents.length) { setAllDashboards([]); return; }
    const running = agents.filter(a => a.running);
    Promise.all(running.map(async (agent) => {
      return fetchDashboards(agent.name, agent.serverUrl || "", agent.token || "");
    })).then(results => setAllDashboards(results.flat()));
  }, [agents]);

  const dashboardList = allDashboards.filter(d => d.agentName === activeAgent?.name).map(d => d.name);

  const openPanel = useCallback((html: string, title: string, dashboard?: string) => {
    setPanelHtml({ html, title, dashboard });
    if (dashboard) { setActiveDashboard(dashboard); localStorage.setItem("kern-active-dashboard", dashboard); }
  }, []);

  const closePanel = useCallback(() => {
    setPanelHtml(null);
    setActiveDashboard(null);
    localStorage.removeItem("kern-active-dashboard");
  }, []);

  const loadAndOpen = useCallback((name: string, agentName: string, serverUrl: string, token: string) => {
    loadDashboardHtml(name, agentName, serverUrl, token)
      .then(html => {
        if (html) {
          setPanelHtml({ html, title: name, dashboard: name });
          setActiveDashboard(name);
          localStorage.setItem("kern-active-dashboard", name);
        } else {
          closePanel();
        }
      });
  }, [closePanel]);

  // Restore active dashboard on load
  useEffect(() => {
    if (!activeAgent) return;
    const saved = localStorage.getItem("kern-active-dashboard");
    if (saved) loadAndOpen(saved, activeAgent.name, activeAgent.serverUrl || "", activeAgent.token || "");
  }, [activeAgent]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close panel if active dashboard no longer exists
  useEffect(() => {
    if (activeDashboard && allDashboards.length > 0 && !allDashboards.some(d => d.name === activeDashboard)) {
      closePanel();
    }
  }, [allDashboards, activeDashboard, closePanel]);

  const store: DashboardStore = {
    allDashboards,
    activeDashboard,
    dashboardList,
    panelHtml,
    activeAgent,
    openPanel,
    closePanel,
    loadAndOpen,
  };

  // Update singleton reference
  _store = store;

  return store;
}
