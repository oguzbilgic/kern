import type { MemoryDB } from "../memory.js";
import type { KernConfig } from "../config.js";
import type { StreamEvent } from "../runtime.js";

/**
 * Plugin context — passed to all lifecycle hooks.
 * Provides access to shared infrastructure without coupling to runtime internals.
 */
export interface PluginContext {
  agentDir: string;
  config: KernConfig;
  db: MemoryDB;
  sessionId: () => string | null;
}

/**
 * Route handler — raw HTTP request/response like server.ts uses.
 */
export interface RouteHandler {
  method: "GET" | "POST";
  path: string | RegExp;
  handler: (req: any, res: any, match?: RegExpMatchArray) => void | Promise<void>;
}

/**
 * Content to inject into system prompt before context assembly.
 */
export interface ContextInjection {
  /** XML tag name wrapping the content */
  label: string;
  /** The content to inject */
  content: string;
}

/**
 * Context passed to onBeforeContext hook.
 */
export interface BeforeContextInfo {
  /** Number of messages trimmed from start */
  trimmedCount: number;
  /** Token budget available for this injection */
  tokenBudget: number;
  /** Last user message text (for query-based injection like recall) */
  userQuery: string;
  /** Session ID */
  sessionId: string;
}

/**
 * KernPlugin — a self-contained feature module.
 *
 * Bundles tools, HTTP routes, SSE event types, and runtime lifecycle hooks.
 * Core server registers routes, runtime dispatches hooks, UI renders slots.
 */
export interface KernPlugin {
  name: string;

  /** Tools to register (merged into allTools) */
  tools?: Record<string, any>;

  /** HTTP routes to mount on the agent server */
  routes?: RouteHandler[];

  /** SSE event types this plugin emits */
  events?: string[];

  // --- Lifecycle hooks ---

  /** Called once on startup after DB is ready */
  onStartup?: (ctx: PluginContext) => Promise<void>;

  /** Called on graceful shutdown */
  onShutdown?: (ctx: PluginContext) => Promise<void>;

  /**
   * Called on each streaming step (tool-result).
   * Use to detect plugin-specific tool output and emit custom events.
   */
  onToolResult?: (
    toolName: string,
    result: string,
    emit: (event: StreamEvent) => void,
    ctx: PluginContext,
  ) => void;

  /**
   * Called after each completed turn. Use for async indexing work.
   */
  onTurnFinish?: (sessionId: string, ctx: PluginContext) => Promise<void>;

  /**
   * Called during context assembly to inject content into the system prompt.
   * Returns content to inject, or null to skip.
   */
  onBeforeContext?: (info: BeforeContextInfo, ctx: PluginContext) => Promise<ContextInjection | null>;

  /**
   * Called when building /status response. Return key-value pairs to merge.
   */
  onStatus?: (ctx: PluginContext) => Record<string, any>;
}
