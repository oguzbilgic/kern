/**
 * Dashboard plugin — UI integration
 *
 * Centralizes all dashboard/render-specific logic so the core web app
 * only needs to import from this single entrypoint.
 */

export { RenderBlock, RenderCard, RenderPanel, DashboardButton } from "./components";

import type { ChatMessage, StreamEvent, DashboardInfo } from "../../lib/types";

// --- Event handling ---

/** Check if a stream event is a render event */
export function isRenderEvent(ev: StreamEvent): ev is StreamEvent & { type: "render" } {
  return ev.type === "render";
}

/** Convert a render stream event into a ChatMessage */
export function renderEventToMessage(ev: StreamEvent & { type: "render" }): ChatMessage {
  const rTitle = ev.render.title || "Render";
  const rTarget = ev.render.target || "inline";
  return {
    id: `render-${Date.now()}`,
    role: "render",
    text: `📊 ${rTitle}`,
    renderHtml: ev.render.html,
    renderTarget: rTarget,
    renderTitle: rTitle,
    renderDashboard: ev.render.dashboard,
  };
}

/** Check if a tool call is for the render tool (should be hidden in chat) */
export function isRenderToolCall(toolName: string): boolean {
  return toolName === "render";
}

/** Check if a ChatMessage is a panel-target render */
export function isPanelRender(msg: ChatMessage): boolean {
  return msg.role === "render" && msg.renderTarget === "panel";
}

// --- Dashboard discovery ---

/** Fetch dashboards from an agent */
export async function fetchDashboards(
  agentName: string,
  serverUrl: string,
  token: string
): Promise<DashboardInfo[]> {
  try {
    const base = serverUrl.replace(/\/$/, "");
    const r = await fetch(`${base}/api/agents/${agentName}/dashboards`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return [];
    const d = await r.json();
    return (d.dashboards || []).map((name: string) => ({
      name,
      agentName,
      serverUrl,
      token,
    }));
  } catch {
    return [];
  }
}

/** Load a dashboard's HTML with data injection from server */
export async function loadDashboardHtml(
  name: string,
  agentName: string,
  serverUrl: string,
  token: string
): Promise<string | null> {
  try {
    const base = serverUrl.replace(/\/$/, "");
    const r = await fetch(`${base}/api/agents/${agentName}/d/${name}/index.html`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  }
}

// --- Activity description for thinking indicator ---

export function renderActivityLabel(input: Record<string, unknown>): string {
  return String(input.dashboard || input.title || "");
}
