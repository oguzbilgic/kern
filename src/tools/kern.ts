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

export const kernTool = tool({
  description:
    "Manage your own kern runtime. Check status, view config, or pair users.",
  inputSchema: z.object({
    action: z
      .enum(["status", "config", "env", "pair", "users", "restart"])
      .describe(
        "status: runtime info. config: show config. env: show env var names. pair: approve a pairing code (provide code param). users: list paired users. restart: restart the runtime to pick up config changes.",
      ),
    code: z
      .string()
      .optional()
      .describe("Pairing code to approve (for pair action). Format: KERN-XXXX"),
  }),
  execute: async ({ action, code }) => {
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

        const stats = _getSessionStats ? _getSessionStats() : null;
        const sessionLine = stats
          ? `session: ~${stats.estimatedTokens} tokens (${stats.totalMessages} messages)`
          : `messages: ${_messageCount}`;
        const contextLine = stats
          ? `context: ~${stats.windowTokens} tokens (sent to API after trim)`
          : "";

        return [
          `kern: ${_version}`,
          `agent: ${_agentDir}`,
          `model: ${_config.provider}/${_config.model}`,
          `toolScope: ${_config.toolScope}`,
          sessionLine,
          contextLine,
          `api usage: ${_totalPromptTokens + _totalCompletionTokens} tokens (in: ${_totalPromptTokens}, out: ${_totalCompletionTokens})`,
          `uptime: ${uptimeStr}`,
        ].filter(Boolean).join("\n");
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

      case "restart": {
        if (_reloadFn) {
          await _reloadFn();
        }
        return "Restarting... The turn will be interrupted but I'll pick up where I left off.";
      }

      default:
        return `Unknown action: ${action}`;
    }
  },
});
