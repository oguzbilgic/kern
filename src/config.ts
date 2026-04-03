import { readFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { config as loadDotenv } from "dotenv";
import { log, type LogLevel } from "./log.js";

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
  logLevel: LogLevel;
}

const TOOL_SCOPES: Record<ToolScope, string[]> = {
  full: ["bash", "read", "write", "edit", "glob", "grep", "webfetch", "kern", "message", "recall"],
  write: ["read", "write", "edit", "glob", "grep", "webfetch", "kern", "message", "recall"],
  read: ["read", "glob", "grep", "webfetch", "kern", "recall"],
};

export const configDefaults: KernConfig = {
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
  logLevel: "info",
};

const FIELD_TYPES: Record<string, string> = {
  model: "string",
  provider: "string",
  toolScope: "string",
  maxSteps: "number",
  maxContextTokens: "number",
  maxToolResultChars: "number",
  historyBudget: "number",
  recall: "boolean",
  autoRecall: "boolean",
  heartbeatInterval: "number",
  logLevel: "string",
};

function validateConfig(userConfig: Record<string, unknown>): void {
  for (const key of Object.keys(userConfig)) {
    if (!(key in FIELD_TYPES)) {
      log.warn("config", `unknown field "${key}" — ignored`);
      continue;
    }
    const expected = FIELD_TYPES[key];
    const actual = typeof userConfig[key];
    if (actual !== expected) {
      log.warn("config", `"${key}" should be ${expected}, got ${actual} — using default`);
    }
  }
}

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
    return configDefaults;
  }

  try {
    const raw = await readFile(configPath, "utf-8");
    const userConfig = JSON.parse(raw);
    validateConfig(userConfig);

    // Filter out unknown and wrong-type fields
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(userConfig)) {
      if (key in FIELD_TYPES && typeof value === FIELD_TYPES[key]) {
        cleaned[key] = value;
      }
    }

    return { ...configDefaults, ...cleaned };
  } catch {
    return configDefaults;
  }
}
