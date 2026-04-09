/**
 * Plugin loader — registers all UI plugins on import.
 * Import this once at app root to activate all plugins.
 */

import { registerPlugin } from "./registry";
import { dashboardPlugin } from "./dashboard";
import { useDashboards } from "./dashboard/useDashboards";
import type { AgentInfo } from "../lib/types";

// Register built-in plugins
registerPlugin(dashboardPlugin);

/**
 * Initialize all plugin hooks. Call once at app root.
 * Each plugin that needs React state registers its hook here.
 */
export function usePluginInit(agents: AgentInfo[], activeAgent: AgentInfo | null) {
  // Dashboard plugin needs to track agents for dashboard discovery
  useDashboards(agents, activeAgent);
}

export { getPlugins } from "./registry";
export type { UIPlugin, RenderContext, SidebarContext, HeaderContext, PanelContext } from "./registry";
