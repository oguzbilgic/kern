"use client";

import type { ReactNode } from "react";
import type { ChatMessage, StreamEvent, AgentInfo } from "../lib/types";

// --- Plugin interface ---

export interface UIPlugin {
  /** Unique plugin name */
  name: string;

  /** Handle a stream event. Return ChatMessage to add to chat, or null to skip. */
  handleStreamEvent?: (ev: StreamEvent, inTurn: boolean) => {
    message?: ChatMessage;
    panelOpen?: { html: string; title: string };
    hideToolCall?: boolean;
  } | null;

  /** Convert a history tool result to a chat message (return null to skip) */
  handleHistoryToolResult?: (toolName: string, output: string) => ChatMessage | null;

  /** Check if a tool call should be hidden in chat */
  isHiddenTool?: (toolName: string) => boolean;

  /** Activity label for thinking indicator */
  activityLabel?: (toolName: string, input?: Record<string, unknown>) => string | null;

  /** Activity detail for thinking tooltip */
  activityDetail?: (toolName: string, input?: Record<string, unknown>) => string | null;

  /** Render a plugin-role message in chat */
  renderMessage?: (msg: ChatMessage, ctx: RenderContext) => ReactNode | null;

  /** Render sidebar section below agents */
  renderSidebar?: (ctx: SidebarContext) => ReactNode | null;

  /** Render header buttons */
  renderHeader?: (ctx: HeaderContext) => ReactNode | null;

  /** Render a side panel (returns null if plugin has no panel to show) */
  renderPanel?: (ctx: PanelContext) => ReactNode | null;

  /** Whether the plugin currently has an active panel */
  hasPanel?: () => boolean;

  /** Close the plugin's panel */
  closePanel?: () => void;

  /** Minimum chat width when panel is open */
  panelMinChatWidth?: number;
}

export interface RenderContext {
  agentName: string;
  token: string;
  serverUrl?: string;
  onOpenPanel?: (html: string, title: string) => void;
}

export interface SidebarContext {
  agents: AgentInfo[];
  activeAgent: string | null;
  mini: boolean;
}

export interface HeaderContext {
  agentName: string;
  serverUrl?: string;
  token: string;
}

export interface PanelContext {
  onClose: () => void;
}

// --- Registry ---

const plugins: UIPlugin[] = [];

export function registerPlugin(plugin: UIPlugin) {
  if (!plugins.find(p => p.name === plugin.name)) {
    plugins.push(plugin);
  }
}

export function getPlugins(): UIPlugin[] {
  return plugins;
}

/** Try all plugins to render a message. Returns first non-null result. */
export function renderPluginMessage(msg: ChatMessage, ctx: RenderContext): ReactNode | null {
  for (const plugin of plugins) {
    const node = plugin.renderMessage?.(msg, ctx);
    if (node) return node;
  }
  return null;
}

/** Collect sidebar sections from all plugins */
export function renderPluginSidebars(ctx: SidebarContext): ReactNode[] {
  const nodes: ReactNode[] = [];
  for (const plugin of plugins) {
    const node = plugin.renderSidebar?.(ctx);
    if (node) nodes.push(node);
  }
  return nodes;
}

/** Collect header buttons from all plugins */
export function renderPluginHeaders(ctx: HeaderContext): ReactNode[] {
  const nodes: ReactNode[] = [];
  for (const plugin of plugins) {
    const node = plugin.renderHeader?.(ctx);
    if (node) nodes.push(node);
  }
  return nodes;
}

/** Find the first plugin with an active panel and render it */
export function renderPluginPanel(ctx: PanelContext): ReactNode | null {
  for (const plugin of plugins) {
    if (plugin.hasPanel?.()) {
      return plugin.renderPanel?.(ctx) ?? null;
    }
  }
  return null;
}

/** Check if any plugin has an active panel */
export function hasPluginPanel(): boolean {
  return plugins.some(p => p.hasPanel?.());
}

/** Get the minimum chat width required by active panel plugin */
export function pluginPanelMinChatWidth(): number {
  for (const plugin of plugins) {
    if (plugin.hasPanel?.() && plugin.panelMinChatWidth) {
      return plugin.panelMinChatWidth;
    }
  }
  return 0;
}
