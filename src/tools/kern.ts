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
let _version = "unknown";
let _totalPromptTokens = 0;
let _totalCompletionTokens = 0;
let _usageFile = "";
let _getSessionStats: (() => { totalMessages: number; estimatedTokens: number; windowTokens: number }) | null = null;
let _reloadFn: (() => Promise<void>) | null = null;
let _pairingManager: any = null;
let _getQueueStatus: (() => { processing: boolean; pending: number; activeChannel: string | null }) | null = null;
let _getHubStatus: (() => { url: string; connected: boolean } | null) | null = null;

export function setQueueStatusFn(fn: () => { processing: boolean; pending: number; activeChannel: string | null }) {
  _getQueueStatus = fn;
}

export function setHubStatusFn(fn: () => { url: string; connected: boolean } | null) {
  _getHubStatus = fn;
}

export async function initKernTool(opts: {
  agentDir: string;
  config: any;
  sessionId: string;
  getSessionStats?: () => { totalMessages: number; estimatedTokens: number; windowTokens: number };
  reload?: () => Promise<void>;
  pairingManager?: any;
}) {
  _agentDir = opts.agentDir;
  _config = opts.config;
  _sessionId = opts.sessionId;
  _startedAt = Date.now();
  _messageCount = 0;
  _getSessionStats = opts.getSessionStats || null;
  _reloadFn = opts.reload || null;
  _pairingManager = opts.pairingManager || null;
  _usageFile = join(_agentDir, ".kern", "usage.json");
  // Load persisted usage
  try {
    const usage = JSON.parse(await readFile(_usageFile, "utf-8"));
    _totalPromptTokens = usage.promptTokens || 0;
    _totalCompletionTokens = usage.completionTokens || 0;
  } catch {
    _totalPromptTokens = 0;
    _totalCompletionTokens = 0;
  }
  try {
    const pkg = JSON.parse(await readFile(join(import.meta.dirname, "..", "..", "package.json"), "utf-8"));
    _version = pkg.version || "unknown";
  } catch {
    _version = "unknown";
  }
}

export function incrementMessageCount() {
  _messageCount++;
}

export async function addTokenUsage(promptTokens: number, completionTokens: number) {
  _totalPromptTokens += promptTokens;
  _totalCompletionTokens += completionTokens;
  // Persist
  try {
    const { writeFile } = await import("fs/promises");
    await writeFile(_usageFile, JSON.stringify({
      promptTokens: _totalPromptTokens,
      completionTokens: _totalCompletionTokens,
      updatedAt: new Date().toISOString(),
    }, null, 2) + "\n");
  } catch {}
}

export interface StatusData {
  version: string;
  agent: string;
  model: string;
  provider: string;
  toolScope: string;
  uptime: string;
  session: string;
  context: string | null;
  apiUsage: string;
  promptTokens: number;
  completionTokens: number;
  queue: string;
  hub: string | null;
}

export function getStatusData(): StatusData {
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

  const stats = _getSessionStats ? _getSessionStats() : null;
  const session = stats
    ? `~${stats.estimatedTokens} tokens (${stats.totalMessages} messages)`
    : `${_messageCount} messages`;
  const context = stats
    ? `~${stats.windowTokens} tokens`
    : null;
  const totalTokens = _totalPromptTokens + _totalCompletionTokens;
  const apiUsage = `${totalTokens} tokens (in: ${_totalPromptTokens}, out: ${_totalCompletionTokens})`;

  const qs = _getQueueStatus ? _getQueueStatus() : null;
  const queueStr = qs
    ? qs.processing ? `busy (${qs.pending} pending)` : `idle (${qs.pending} pending)`
    : "unknown";

  return {
    version: _version,
    agent: _agentDir,
    model: _config.model,
    provider: _config.provider,
    toolScope: _config.toolScope,
    uptime: uptimeStr,
    session,
    context,
    apiUsage,
    promptTokens: _totalPromptTokens,
    completionTokens: _totalCompletionTokens,
    queue: queueStr,
    hub: _getHubStatus ? (() => { const h = _getHubStatus!(); return h ? `${h.url} (${h.connected ? 'connected' : 'disconnected'})` : null; })() : null,
  };
}

export function formatStatus(data: StatusData): string {
  return [
    `kern: ${data.version}`,
    `agent: ${data.agent}`,
    `model: ${data.provider}/${data.model}`,
    `toolScope: ${data.toolScope}`,
    `session: ${data.session}`,
    data.context ? `context: ${data.context}` : "",
    `api usage: ${data.apiUsage}`,
    `queue: ${data.queue}`,
    data.hub ? `hub: ${data.hub}` : "",
    `uptime: ${data.uptime}`,
  ].filter(Boolean).join("\n");
}

export function getStatus(): string {
  return formatStatus(getStatusData());
}

export const kernTool = tool({
  description:
    "Manage your own kern runtime. Check status, view config, or pair users.",
  inputSchema: z.object({
    action: z
      .enum(["status", "config", "env", "pair", "users"])
      .describe(
        "status: runtime info. config: show config. env: show env var names. pair: approve a pairing code (provide code param). users: list paired users.",
      ),
    code: z
      .string()
      .optional()
      .describe("Pairing code to approve (for pair action). Format: KERN-XXXX"),
  }),
  execute: async ({ action, code }) => {
    switch (action) {
      case "status":
        return getStatus();

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

      case "pair": {
        if (!_pairingManager) return "Pairing not available.";
        if (!code) return "Provide a pairing code. Usage: kern({ action: 'pair', code: 'KERN-XXXX' })";
        const result = await _pairingManager.pair(code);
        if (!result) return `Invalid or expired pairing code: ${code}`;
        return `Paired! User ${result.userId} from ${result.interface} is now approved.\n\nYou should now update USERS.md with their identity, role, and any access notes your operator provided.`;
      }

      case "users": {
        if (!_pairingManager) return "Pairing not available.";
        const paired = _pairingManager.getPairedUsers();
        const pending = _pairingManager.getPendingCodes();
        const lines: string[] = [];
        if (paired.length > 0) {
          lines.push("Paired users:");
          for (const u of paired) {
            lines.push(`  ${u.userId} (${u.interface}, paired ${u.pairedAt})`);
          }
        } else {
          lines.push("No paired users.");
        }
        if (pending.length > 0) {
          lines.push("\nPending codes:");
          for (const p of pending) {
            lines.push(`  ${p.code} → ${p.userId} (${p.interface})`);
          }
        }
        return lines.join("\n");
      }

      default:
        return `Unknown action: ${action}`;
    }
  },
});
