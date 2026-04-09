import type { KernPlugin } from "../types.js";
import { renderTool } from "./tool.js";
import { createDashboardRoutes } from "./routes.js";

/**
 * Dashboard plugin — agent-created web dashboards and inline HTML rendering.
 *
 * Provides:
 * - `render` tool for inline HTML and dashboard panel display
 * - `/dashboards` and `/d/<name>/*` HTTP routes
 * - `render` SSE event for real-time UI updates
 */
export const dashboardPlugin: KernPlugin = {
  name: "dashboard",

  tools: {
    render: renderTool,
  },

  events: ["render"],

  onStartup: async (ctx) => {
    // Dashboard routes need agentDir — create them at startup
    const routes = createDashboardRoutes(ctx.agentDir);
    // Attach routes dynamically (they'll be picked up by server)
    dashboardPlugin.routes = routes;
  },

  onToolResult: (toolName, result, emit) => {
    if (toolName !== "render") return;
    try {
      const parsed = JSON.parse(result);
      if (parsed.__kern_render) {
        emit({
          type: "render",
          render: {
            html: parsed.html,
            dashboard: parsed.dashboard,
            target: parsed.target || "inline",
            title: parsed.title || "Render",
          },
        });
      }
    } catch {
      // Not JSON or not a render result — ignore
    }
  },
};
