"use client";

import { useState, useCallback, useEffect } from "react";
import type { AgentInfo, DashboardInfo } from "../../lib/types";
import { fetchDashboards, loadDashboardHtml } from "./index";

interface DashboardState {
  allDashboards: DashboardInfo[];
  activeDashboard: string | null;
  dashboardList: string[];
  panelHtml: { html: string; title: string; dashboard?: string } | null;
  handleOpenPanel: (html: string, title: string, dashboard?: string) => void;
  closePanel: () => void;
  openDashboard: (name: string, fromAgent?: DashboardInfo) => void;
}

export function useDashboards(agents: AgentInfo[], activeAgent: AgentInfo | null): DashboardState {
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

  const handleOpenPanel = useCallback((html: string, title: string, dashboard?: string) => {
    setPanelHtml({ html, title, dashboard });
    if (dashboard) { setActiveDashboard(dashboard); localStorage.setItem("kern-active-dashboard", dashboard); }
  }, []);

  const closePanel = useCallback(() => {
    setPanelHtml(null);
    setActiveDashboard(null);
    localStorage.removeItem("kern-active-dashboard");
  }, []);

  const openDashboard = useCallback((name: string, fromAgent?: DashboardInfo) => {
    const agent = fromAgent
      ? agents.find(a => a.name === fromAgent.agentName && a.serverUrl === fromAgent.serverUrl) || activeAgent
      : activeAgent;
    if (!agent) return;
    loadDashboardHtml(name, agent.name, agent.serverUrl || "", agent.token || "")
      .then(html => {
        if (html) {
          setPanelHtml({ html, title: name, dashboard: name });
          setActiveDashboard(name);
          localStorage.setItem("kern-active-dashboard", name);
        } else {
          closePanel();
        }
      });
  }, [activeAgent, agents, closePanel]);

  // Restore active dashboard on load
  useEffect(() => {
    if (!activeAgent) return;
    const saved = localStorage.getItem("kern-active-dashboard");
    if (saved) openDashboard(saved);
  }, [activeAgent]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close panel if active dashboard no longer exists
  useEffect(() => {
    if (activeDashboard && allDashboards.length > 0 && !allDashboards.some(d => d.name === activeDashboard)) {
      closePanel();
    }
  }, [allDashboards, activeDashboard, closePanel]);

  return { allDashboards, activeDashboard, dashboardList, panelHtml, handleOpenPanel, closePanel, openDashboard };
}
