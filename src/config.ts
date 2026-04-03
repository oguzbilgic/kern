import { readFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { config as loadDotenv } from "dotenv";

export type ToolScope = "full" | "write" | "read";

export interface KernConfig {
  // Core
  model: string;
  provider: string;
  toolScope: ToolScope;
  maxSteps: number;

  // Context window
  maxContextTokens: number;
  maxToolResultChars: number;
  historyBudget: number;

  // Memory
  recall: boolean;
  autoRecall: boolean;

  // Runtime
  heartbeatInterval: number;


}

const TOOL_SCOPES: Record<ToolScope, string[]> = {
  full: ["bash", "read", "write", "edit", "glob", "grep", "webfetch", "kern", "message", "recall"],
  write: ["read", "write", "edit", "glob", "grep", "webfetch", "kern", "message", "recall"],
  read: ["read", "glob", "grep", "webfetch", "kern", "recall"],
};

const defaults: KernConfig = {
  model: "anthropic/claude-opus-4.6",
  provider: "openrouter",
  toolScope: "full",
  maxSteps: 30,
  maxContextTokens: 50000,
  maxToolResultChars: 20000,
  historyBudget: 0.2,
  recall: true,
  autoRecall: false,
  heartbeatInterval: 60,
};

export function getToolsForScope(scope: ToolScope): string[] {
  return TOOL_SCOPES[scope] || TOOL_SCOPES.full;
}

export async function loadConfig(agentDir: string): Promise<KernConfig> {
  // Load .kern/.env
  const envPath = join(agentDir, ".kern", ".env");
  if (existsSync(envPath)) {
    loadDotenv({ path: envPath });
  }

  // Load .kern/config.json
  const configPath = join(agentDir, ".kern", "config.json");
  if (!existsSync(configPath)) {
    return defaults;
  }

  try {
    const raw = await readFile(configPath, "utf-8");
    const userConfig = JSON.parse(raw);
    // Support legacy "tools" array — ignore it, use toolScope
    const { tools, ...rest } = userConfig;
    return { ...defaults, ...rest };
  } catch {
    return defaults;
  }
}
