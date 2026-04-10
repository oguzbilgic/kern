/**
 * Dashboard plugin — UI integration
 *
 * Self-contained plugin that handles all render/dashboard functionality.
 * The core web app delegates to this via the plugin registry.
 * No dashboard-specific types, imports, or logic exists in core.
 *
 * Panel display is handled via the Surface system — the plugin registers
 * a panel surface when a dashboard is open. Core's SurfacePanel provides
 * all chrome (resize, title, close). Plugin only provides content (iframe).
 */

export { RenderBlock, RenderCard, DashboardButton, DashboardSidebar, DashboardIframe, getDashboardData } from "./components";
export { useDashboards } from "./useDashboards";

import type { ReactNode } from "react";
import { createElement } from "react";
import type { ChatMessage, StreamEvent } from "../../lib/types";
import type { UIPlugin, RenderContext, SidebarContext, HeaderContext } from "../registry";
import { RenderBlock, RenderCard, DashboardButton, DashboardSidebar, getDashboardData } from "./components";
import { getDashboardStore } from "./useDashboards";

// --- Dashboard-local types (not exported to core) ---

export interface DashboardInfo {
  name: string;
  baseUrl: string;
}

// --- API helpers ---

export async function fetchDashboards(baseUrl: string, token: string): Promise<DashboardInfo[]> {
  try {
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(`${baseUrl}/dashboards`, { headers });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.dashboards || []).map((name: string) => ({ name, baseUrl }));
  } catch {
    return [];
  }
}

export async function loadDashboardHtml(name: string, baseUrl: string, token: string): Promise<string | null> {
  try {
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(`${baseUrl}/d/${name}/`, { headers });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export const PLUGIN_NAME = "dashboard";
export const ROLE = "render";

// --- Stream event handling ---

export function isRenderEvent(ev: StreamEvent): ev is StreamEvent & { type: "plugin" } {
  return ev.type === "plugin" && (ev as { plugin?: string }).plugin === PLUGIN_NAME;
}

export function isRenderToolCall(toolName: string): boolean {
  return toolName === "render";
}

// --- Plugin definition ---

export const dashboardPlugin: UIPlugin = {
  name: PLUGIN_NAME,

  handleStreamEvent(ev: StreamEvent) {
    if (ev.type !== "render") return null;
    const render = (ev as { render: { html: string; dashboard?: string | null; target: string; title: string } }).render;
    const title = render.title || "Render";
    const target = render.target || "inline";
    const msg: ChatMessage = {
      id: `render-${Date.now()}`,
      role: ROLE,
      text: title,
      pluginData: {
        html: render.html,
        target,
        title,
        dashboard: render.dashboard,
      },
    };

    // If panel target, tell the store to open (which registers a surface)
    if (target === "panel") {
      const store = getDashboardStore();
      store?.openPanel(render.html, title, render.dashboard ?? undefined);
    }

    return { message: msg };
  },

  handleHistoryToolResult(toolName: string, output: string) {
    if (toolName !== "render") return null;
    try {
      const parsed = JSON.parse(output);
      if (!parsed.__kern_render) return null;
      return {
        id: `render-hist-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: ROLE,
        text: parsed.title || "Render",
        pluginData: {
          html: parsed.html,
          target: parsed.target || "inline",
          title: parsed.title || "Render",
          dashboard: parsed.dashboard,
        },
      };
    } catch {
      return null;
    }
  },

  isHiddenTool(toolName: string) {
    return toolName === "render";
  },

  activityLabel(toolName: string) {
    return toolName === "render" ? "rendering" : null;
  },

  activityDetail(toolName: string, input?: Record<string, unknown>) {
    if (toolName !== "render" || !input) return null;
    return String(input.dashboard || input.title || "");
  },

  renderMessage(msg: ChatMessage, ctx: RenderContext): ReactNode | null {
    if (msg.role !== ROLE) return null;
    const { target } = getDashboardData(msg);
    const store = getDashboardStore();
    const onOpen = (html: string, title: string) => {
      store?.openPanel(html, title);
    };
    if (target === "panel") {
      return createElement(RenderCard, { msg, onOpenPanel: onOpen });
    }
    return createElement(RenderBlock, { msg, onOpenPanel: onOpen });
  },

  renderSidebar(ctx: SidebarContext): ReactNode | null {
    return createElement(DashboardSidebar, { ...ctx });
  },

  renderHeader(ctx: HeaderContext): ReactNode | null {
    const store = getDashboardStore();
    return createElement(DashboardButton, {
      baseUrl: ctx.baseUrl,
      token: ctx.token,
      onOpenDashboard: (name: string) => store?.loadAndOpen(name, ctx.baseUrl, ctx.token),
    });
  },
};
