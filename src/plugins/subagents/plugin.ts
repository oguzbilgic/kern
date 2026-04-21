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
  if (record.status === "done") {
    return record.result || "(no result)";
  }
  const dur = record.finishedAt && record.startedAt
    ? `${Math.round((+new Date(record.finishedAt) - +new Date(record.startedAt)) / 1000)}s`
    : "?";
  const header = `[subagent:${record.id} ${record.status}, ${dur}]`;
  if (record.status === "failed") {
    return `${header}\n${record.error || "unknown error"}`;
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

  commands: {
    "/subagents": {
      description: "list sub-agents",
      handler: async () => {
        if (!registry) return "Sub-agents plugin not loaded.";
        const records = registry.list();
        if (records.length === 0) {
          return "No sub-agents. The agent can use the spawn tool to delegate a task.";
        }

        // running first, then by finishedAt desc (most recent on top)
        const sorted = [...records].sort((a, b) => {
          if (a.status === "running" && b.status !== "running") return -1;
          if (b.status === "running" && a.status !== "running") return 1;
          const aFin = a.finishedAt || "";
          const bFin = b.finishedAt || "";
          return bFin.localeCompare(aFin);
        });

        const running = records.filter((r) => r.status === "running").length;
        const lines = [`Sub-agents (${running} running, ${records.length} total)`, ""];

        for (const r of sorted) {
          const icon =
            r.status === "running" ? "⟳" :
            r.status === "done"    ? "✓" :
            r.status === "failed"  ? "✗" :
            /* cancelled */          "⊘";

          const prompt = r.prompt.length > 40
            ? r.prompt.slice(0, 40) + "..."
            : r.prompt;

          const end = r.finishedAt ? new Date(r.finishedAt) : new Date();
          const dur = `${Math.round((+end - +new Date(r.startedAt)) / 1000)}s`;
          const calls = `${r.toolCalls} tool call${r.toolCalls === 1 ? "" : "s"}`;

          const parts = [`"${prompt}"`, dur, calls];
          if (r.status === "failed" || r.status === "cancelled") parts.push(r.status);

          lines.push(`  ${icon} ${r.id} — ${parts.join(" · ")}`);
        }

        return lines.join("\n");
      },
    },
  },
};
