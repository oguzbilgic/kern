"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { createElement } from "react";
import type { AgentInfo } from "../../lib/types";
import type { DashboardInfo } from "./index";
import { fetchDashboards, loadDashboardHtml } from "./index";
import { registerSurface, unregisterSurface } from "../../lib/surfaces";
import { DashboardIframe } from "./components";

interface DashboardStore {
  allDashboards: DashboardInfo[];
  activeDashboard: string | null;
  dashboardList: string[];
  panelHtml: { html: string; title: string; dashboard?: string } | null;
  activeAgent: AgentInfo | null;
  openPanel: (html: string, title: string, dashboard?: string) => void;
  closePanel: () => void;
  loadAndOpen: (name: string, baseUrl: string, token: string) => void;
}

// Singleton store reference so plugin definition can access state without React context
let _store: DashboardStore | null = null;

export function getDashboardStore(): DashboardStore | null {
  return _store;
}

const SURFACE_ID = "dashboard:panel";

/**
 * React hook that owns all dashboard state.
 * Registers/unregisters a panel surface when dashboard content is active.
 */
export function useDashboards(agents: AgentInfo[], activeAgent: AgentInfo | null): DashboardStore {
  const [panelHtml, setPanelHtml] = useState<{ html: string; title: string; dashboard?: string } | null>(null);
  const [allDashboards, setAllDashboards] = useState<DashboardInfo[]>([]);
  const [activeDashboard, setActiveDashboard] = useState<string | null>(null);
  const panelRef = useRef(panelHtml);
  panelRef.current = panelHtml;

  // Fetch dashboards from all running agents
  useEffect(() => {
    if (!agents.length) { setAllDashboards([]); return; }
    const running = agents.filter(a => a.running);
    Promise.all(running.map(async (agent) => {
      return fetchDashboards(agent.baseUrl, agent.token || "");
    })).then(results => setAllDashboards(results.flat()));
  }, [agents]);

  const dashboardList = allDashboards.filter(d => d.baseUrl === activeAgent?.baseUrl).map(d => d.name);

  const openPanel = useCallback((html: string, title: string, dashboard?: string) => {
    setPanelHtml({ html, title, dashboard });
    if (dashboard) { setActiveDashboard(dashboard); localStorage.setItem("kern-active-dashboard", dashboard); }
  }, []);

  const closePanel = useCallback(() => {
    setPanelHtml(null);
    setActiveDashboard(null);
    localStorage.removeItem("kern-active-dashboard");
    unregisterSurface(SURFACE_ID);
  }, []);

  const loadAndOpen = useCallback((name: string, baseUrl: string, token: string) => {
    loadDashboardHtml(name, baseUrl, token)
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

  // Stable render function that reads from ref to avoid re-registration loops
  const renderPanel = useCallback(() => createElement(DashboardIframe, { html: panelRef.current?.html || "" }), []);
  const onClosePanel = useCallback(() => closePanel(), [closePanel]);

  // Register/unregister panel surface when content changes
  useEffect(() => {
    if (panelHtml) {
      registerSurface({
        id: SURFACE_ID,
        group: "dashboard",
        label: panelHtml.title || "Dashboard",
        mode: "panel",
        panelWidth: { min: 280, max: 800, default: 480 },
        render: renderPanel,
        onClose: onClosePanel,
      });
    } else {
      unregisterSurface(SURFACE_ID);
    }
  }, [panelHtml, renderPanel, onClosePanel]);

  // Restore active dashboard on load
  useEffect(() => {
    if (!activeAgent) return;
    const saved = localStorage.getItem("kern-active-dashboard");
    if (saved) loadAndOpen(saved, activeAgent.baseUrl, activeAgent.token || "");
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
