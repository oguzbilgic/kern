import { readFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { config as loadDotenv } from "dotenv";

export interface KernConfig {
  model: string;
  provider: string;
  tools: string[];
  maxSteps: number;
  telegram?: {
    allowedUsers?: number[];
  };
}

const defaults: KernConfig = {
  model: "claude-sonnet-4-20250514",
  provider: "anthropic",
  tools: ["bash", "read", "write", "edit", "glob", "grep"],
  maxSteps: 30,
};

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
    return { ...defaults, ...userConfig };
  } catch {
    return defaults;
  }
}

export async function loadSystemPrompt(agentDir: string): Promise<string> {
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

  if (parts.length === 0) {
    return "You are a helpful AI assistant.";
  }

  return parts.join("\n\n---\n\n");
}
