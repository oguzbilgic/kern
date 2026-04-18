import type { KernPlugin, PluginContext } from "../types.js";
import { SubAgentRegistry, type SubAgentRecord, type AnnounceFn } from "./registry.js";
import { spawnTool, subagentsTool, setRegistry } from "./tools.js";
import { log } from "../../log.js";

/**
 * Sub-agents plugin — spawn read-only worker agents in parallel.
 *
 * Parent agents call the spawn tool to delegate focused tasks. Children run
 * in-process with a restricted toolset (read, glob, grep, webfetch, websearch)
 * and no access to plugins. When a child finishes, its result is announced
 * back to the parent as a new turn via an AnnounceFn that app.ts registers
 * (connecting the completion event to the message queue).
 *
 * See src/plugins/subagents/registry.ts for the registry/worker split.
 */

/** The one live registry for this plugin instance. */
let registry: SubAgentRegistry | null = null;

/**
 * Called by app.ts to wire child completion back into the message queue.
 * Must be called before any sub-agents are spawned.
 */
export function setSubAgentAnnouncer(fn: AnnounceFn): void {
  if (!registry) {
    log.warn("subagent", "setSubAgentAnnouncer called before plugin loaded — ignored");
    return;
  }
  registry.setAnnouncer(fn);
}

/** Format a child's completion as an announce message for the parent's queue. */
export function formatAnnounce(record: SubAgentRecord): string {
  const dur = record.finishedAt && record.startedAt
    ? `${Math.round((+new Date(record.finishedAt) - +new Date(record.startedAt)) / 1000)}s`
    : "?";
  const header = `[subagent:${record.id} ${record.status}, ${dur}, ${record.toolCalls} tool calls]`;

  if (record.status === "done") {
    return `${header}\n${record.result || "(no result)"}`;
  }
  if (record.status === "failed") {
    return `${header}\n${record.error || "unknown error"}`;
  }
  if (record.status === "cancelled") {
    return header;
  }
  return header;
}

export const subagentsPlugin: KernPlugin = {
  name: "subagents",

  tools: {
    spawn: spawnTool,
    subagents: subagentsTool,
  },

  toolDescriptions: {
    spawn:
      "Spawn a sub-agent to work on a focused task in parallel (returns immediately; result arrives as a new turn when the child finishes).",
    subagents:
      "List, inspect, or cancel sub-agents you've spawned.",
  },

  onStartup: async (ctx: PluginContext) => {
    registry = new SubAgentRegistry(ctx.agentDir, ctx.config);
    setRegistry(registry);
  },

  onShutdown: async () => {
    if (registry) {
      const cancelled = registry.cancelAll();
      if (cancelled > 0) log("subagent", `cancelled ${cancelled} running on shutdown`);
    }
    registry = null;
  },

  onStatus: () => {
    if (!registry) return {};
    return {
      subagents: {
        running: registry.countRunning(),
        total: registry.list().length,
      },
    };
  },
};
