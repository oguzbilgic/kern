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
  maxContextTokens: number;
  heartbeatInterval: number;
  port?: number;
  host?: string;
  telegram?: {
    allowedUsers?: number[];
    showTools?: boolean;
  };
}

const TOOL_SCOPES: Record<ToolScope, string[]> = {
  full: ["bash", "read", "write", "edit", "glob", "grep", "webfetch", "kern", "message"],
  write: ["read", "write", "edit", "glob", "grep", "webfetch", "kern", "message"],
  read: ["read", "glob", "grep", "webfetch", "kern"],
};

const defaults: KernConfig = {
  model: "anthropic/claude-opus-4.6",
  provider: "openrouter",
  toolScope: "full",
  maxSteps: 30,
  maxContextTokens: 40000,
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
  const kernMdPackage = join(import.meta.dirname, "..", "templates", "KERN.md");
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
    message: "send messages proactively",
  };
  const toolList = tools.map(t => `- **${t}**: ${toolDescriptions[t] || t}`).join("\n");

  parts.push(`### Your tools\n${toolList}`);

  // Docker-specific instructions — injected when running in a container
  // KERN_CONTAINER=1 is set by docker-entrypoint.sh
  if (process.env.KERN_CONTAINER === "1") {
    parts.push(DOCKER_INSTRUCTIONS);
  }

  if (parts.length === 0) {
    return "You are a helpful AI assistant.";
  }

  return parts.join("\n\n---\n\n");
}

const DOCKER_INSTRUCTIONS = `### Docker environment
You are running inside a Docker container. Only \`/agent\` (this repo) is on a persistent volume — everything else is ephemeral and lost on restart.

#### Installing tools
System packages (\`apt-get install\`) do not survive container restarts. Use these options instead:

1. **Persistent binaries** — install standalone binaries to \`/agent/.local/bin/\`. This directory is on PATH and persists across restarts. Gitignored.
   \`\`\`bash
   mkdir -p /agent/.local/bin
   # download or build binary to /agent/.local/bin/
   \`\`\`

2. **Startup script** — create \`.kern/init.sh\` for packages that need \`apt-get\`. This runs on every container start before you. Gitignored. Make it executable.
   \`\`\`bash
   #!/bin/sh
   apt-get update && apt-get install -y python3-pip
   \`\`\`

3. **Ask your operator** — for permanent dependencies, suggest they add \`RUN apt-get install ...\` to the agent Dockerfile and rebuild.

Prefer option 1 when possible (no restart needed). Use option 2 for things that can't be installed to a custom path. Option 3 is best for tools that are always needed.`;
