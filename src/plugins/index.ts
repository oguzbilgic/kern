import type { KernPlugin, PluginContext } from "./types.js";
import { dashboardPlugin } from "./dashboard/plugin.js";
import { log } from "../log.js";

export type { KernPlugin, PluginContext, RouteHandler } from "./types.js";

/**
 * All available plugins. Add new plugins here.
 * In the future, config.plugins can gate which are loaded.
 */
const availablePlugins: KernPlugin[] = [
  dashboardPlugin,
];

/** Active plugin instances after loading */
let activePlugins: KernPlugin[] = [];

/**
 * Load and start plugins based on config.
 * Returns the active plugin list for route/tool registration.
 */
export async function loadPlugins(ctx: PluginContext): Promise<KernPlugin[]> {
  activePlugins = [];

  for (const plugin of availablePlugins) {
    try {
      if (plugin.onStartup) {
        await plugin.onStartup(ctx);
      }
      activePlugins.push(plugin);
      log("plugin", `loaded: ${plugin.name}`);
    } catch (err: any) {
      log.error("plugin", `failed to load ${plugin.name}: ${err.message}`);
    }
  }

  return activePlugins;
}

/**
 * Get all tools from active plugins (merged into one record).
 */
export function getPluginTools(): Record<string, any> {
  const tools: Record<string, any> = {};
  for (const plugin of activePlugins) {
    if (plugin.tools) {
      Object.assign(tools, plugin.tools);
    }
  }
  return tools;
}

/**
 * Dispatch onToolResult hook to all active plugins.
 */
export function dispatchToolResult(
  toolName: string,
  result: string,
  emit: (event: any) => void,
  ctx: PluginContext,
) {
  for (const plugin of activePlugins) {
    if (plugin.onToolResult) {
      plugin.onToolResult(toolName, result, emit, ctx);
    }
  }
}

/**
 * Shutdown all active plugins.
 */
export async function shutdownPlugins(ctx: PluginContext) {
  for (const plugin of activePlugins) {
    if (plugin.onShutdown) {
      try {
        await plugin.onShutdown(ctx);
      } catch (err: any) {
        log.error("plugin", `shutdown error in ${plugin.name}: ${err.message}`);
      }
    }
  }
  activePlugins = [];
}

/**
 * Get all active plugins (for route registration, etc.)
 */
export function getActivePlugins(): KernPlugin[] {
  return activePlugins;
}
