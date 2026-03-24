import { tool } from "ai";
import { z } from "zod";
import { readFile } from "fs/promises";
import { join } from "path";

// These get set by the runtime at init
let _agentDir = "";
let _startedAt = Date.now();
let _messageCount = 0;
let _config: any = {};
let _sessionId = "";

export function initKernTool(opts: {
  agentDir: string;
  config: any;
  sessionId: string;
}) {
  _agentDir = opts.agentDir;
  _config = opts.config;
  _sessionId = opts.sessionId;
  _startedAt = Date.now();
  _messageCount = 0;
}

export function incrementMessageCount() {
  _messageCount++;
}

export const kernTool = tool({
  description:
    "Manage your own kern runtime. Check status, view config, or reload after changes.",
  inputSchema: z.object({
    action: z
      .enum(["status", "config", "env"])
      .describe(
        "status: runtime info (uptime, messages, model). config: show .kern/config.json. env: show .kern/.env variable names (not values).",
      ),
  }),
  execute: async ({ action }) => {
    switch (action) {
      case "status": {
        const uptime = Math.floor((Date.now() - _startedAt) / 1000);
        const hours = Math.floor(uptime / 3600);
        const mins = Math.floor((uptime % 3600) / 60);
        const secs = uptime % 60;
        const uptimeStr =
          hours > 0
            ? `${hours}h ${mins}m ${secs}s`
            : mins > 0
              ? `${mins}m ${secs}s`
              : `${secs}s`;

        return [
          `agent: ${_agentDir}`,
          `session: ${_sessionId}`,
          `model: ${_config.provider}/${_config.model}`,
          `toolScope: ${_config.toolScope}`,
          `messages: ${_messageCount}`,
          `uptime: ${uptimeStr}`,
        ].join("\n");
      }

      case "config": {
        try {
          const configPath = join(_agentDir, ".kern", "config.json");
          return await readFile(configPath, "utf-8");
        } catch {
          return "Error: could not read .kern/config.json";
        }
      }

      case "env": {
        try {
          const envPath = join(_agentDir, ".kern", ".env");
          const content = await readFile(envPath, "utf-8");
          // Show variable names only, mask values
          const lines = content
            .split("\n")
            .filter((l) => l.trim() && !l.startsWith("#"))
            .map((l) => {
              const eq = l.indexOf("=");
              if (eq === -1) return l;
              const key = l.slice(0, eq);
              return `${key}=****`;
            });
          return lines.join("\n") || "No env vars set.";
        } catch {
          return "Error: could not read .kern/.env";
        }
      }

      default:
        return `Unknown action: ${action}`;
    }
  },
});
