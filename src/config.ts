import { readFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { config as loadDotenv } from "dotenv";

export type ToolScope = "full" | "write" | "read";

export interface KernConfig {
  model: string;
  provider: string;
  toolScope: ToolScope;
  maxSteps: number;
  telegram?: {
    allowedUsers?: number[];
  };
}

const TOOL_SCOPES: Record<ToolScope, string[]> = {
  full: ["bash", "read", "write", "edit", "glob", "grep", "webfetch", "kern"],
  write: ["read", "write", "edit", "glob", "grep", "webfetch", "kern"],
  read: ["read", "glob", "grep", "webfetch", "kern"],
};

const defaults: KernConfig = {
  model: "claude-sonnet-4-20250514",
  provider: "anthropic",
  toolScope: "full",
  maxSteps: 30,
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

export async function loadSystemPrompt(agentDir: string, config: KernConfig): Promise<string> {
  const parts: string[] = [];

  // Load AGENTS.md (kernel)
  const agentsPath = join(agentDir, "AGENTS.md");
  if (existsSync(agentsPath)) {
    parts.push(await readFile(agentsPath, "utf-8"));
  }

  // Load IDENTITY.md
  const identityPath = join(agentDir, "IDENTITY.md");
  if (existsSync(identityPath)) {
    parts.push(await readFile(identityPath, "utf-8"));
  }

  // Load KERN.md (runtime context) — from agent dir first, fall back to kern package
  const kernMdAgent = join(agentDir, "KERN.md");
  const kernMdPackage = join(import.meta.dirname, "..", "KERN.md");
  if (existsSync(kernMdAgent)) {
    parts.push(await readFile(kernMdAgent, "utf-8"));
  } else if (existsSync(kernMdPackage)) {
    parts.push(await readFile(kernMdPackage, "utf-8"));
  }

  // Inject live runtime info
  const tools = getToolsForScope(config.toolScope);
  const toolDescriptions: Record<string, string> = {
    bash: "run shell commands",
    read: "read files and directories",
    write: "create or overwrite files",
    edit: "find and replace in files",
    glob: "find files by pattern",
    grep: "search file contents",
    webfetch: "fetch URLs",
    kern: "manage your own runtime (status, config, env)",
  };
  const toolList = tools.map(t => `- **${t}**: ${toolDescriptions[t] || t}`).join("\n");

  parts.push(`### Your tools\n${toolList}`);

  if (parts.length === 0) {
    return "You are a helpful AI assistant.";
  }

  return parts.join("\n\n---\n\n");
}
