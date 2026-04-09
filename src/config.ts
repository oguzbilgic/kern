import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { existsSync, readFileSync } from "fs";
import { config as loadDotenv } from "dotenv";
import { log } from "./log.js";

export type ToolScope = "full" | "write" | "read";

export interface KernConfig {
  // Core
  model: string;
  provider: string;
  toolScope: ToolScope;
  maxSteps: number;
  port: number;

  // Context window
  maxContextTokens: number;
  maxToolResultChars: number;
  summaryBudget: number;

  // Memory
  recall: boolean;
  autoRecall: boolean;

  // Media
  mediaDigest: boolean;
  mediaModel: string;
  mediaContext: number;

  // Interface
  telegramTools: boolean;

  // Runtime
  heartbeatInterval: number;
}

const shell = process.platform === "win32" ? "pwsh" : "bash";

const TOOL_SCOPES: Record<ToolScope, string[]> = {
  full: [shell, "read", "write", "edit", "glob", "grep", "webfetch", "websearch", "kern", "message"],
  write: ["read", "write", "edit", "glob", "grep", "webfetch", "websearch", "kern", "message"],
  read: ["read", "glob", "grep", "webfetch", "websearch", "kern"],
};

export const configDefaults: KernConfig = {
  model: "anthropic/claude-opus-4.6",
  provider: "openrouter",
  toolScope: "full",
  maxSteps: 30,
  port: 0,
  maxContextTokens: 100000,
  maxToolResultChars: 20000,
  summaryBudget: 0.75,
  recall: true,
  autoRecall: false,
  mediaDigest: true,
  mediaModel: "",
  mediaContext: 0,
  telegramTools: false,
  heartbeatInterval: 60,
};

const FIELD_TYPES: Record<string, string> = {
  model: "string",
  provider: "string",
  toolScope: "string",
  maxSteps: "number",
  port: "number",
  maxContextTokens: "number",
  maxToolResultChars: "number",
  summaryBudget: "number",
  recall: "boolean",
  autoRecall: "boolean",
  mediaDigest: "boolean",
  mediaModel: "string",
  mediaContext: "number",
  telegramTools: "boolean",
  heartbeatInterval: "number",
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

/**
 * Write a single field into agent's .kern/config.json, preserving existing fields.
 */
export async function saveConfigField(agentDir: string, key: string, value: unknown): Promise<void> {
  const configPath = join(agentDir, ".kern", "config.json");
  let config: Record<string, unknown> = {};
  try {
    const raw = readFileSync(configPath, "utf-8");
    config = JSON.parse(raw);
  } catch {}
  config[key] = value;
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}
