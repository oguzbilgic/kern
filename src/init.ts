import { mkdir, writeFile, readFile } from "fs/promises";
import { join, resolve } from "path";
import { existsSync } from "fs";
import { createInterface } from "readline";
import { registerAgent, findAgent, isProcessRunning, setPid } from "./registry.js";
import { startAgent, stopAgent } from "./daemon.js";

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question: string, defaultValue?: string): Promise<string> {
  const suffix = defaultValue ? ` (${defaultValue})` : "";
  return new Promise((resolve) => {
    rl.question(`  ${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultValue || "");
    });
  });
}

function print(text: string) {
  console.log(text);
}

const MODEL_DEFAULTS: Record<string, string> = {
  openrouter: "anthropic/claude-opus-4",
  anthropic: "claude-opus-4-20250514",
  openai: "gpt-4o",
};

const API_KEY_LABELS: Record<string, string> = {
  openrouter: "OPENROUTER_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

async function runConfig(name: string, dir: string): Promise<void> {
  print("");
  print(`  kern config — ${name}`);
  print("  ─────────────");
  print("");

  // Load existing config and env
  let currentConfig: any = {};
  try {
    currentConfig = JSON.parse(await readFile(join(dir, ".kern", "config.json"), "utf-8"));
  } catch {}

  let currentEnv: Record<string, string> = {};
  try {
    const envContent = await readFile(join(dir, ".kern", ".env"), "utf-8");
    for (const line of envContent.split("\n")) {
      if (line.trim() && !line.startsWith("#")) {
        const eq = line.indexOf("=");
        if (eq > 0) {
          currentEnv[line.slice(0, eq)] = line.slice(eq + 1);
        }
      }
    }
  } catch {}

  // Provider
  const provider = await ask("Provider", currentConfig.provider || "openrouter");

  // API key — show masked current value
  const apiKeyLabel = API_KEY_LABELS[provider] || "API_KEY";
  const currentKey = currentEnv[apiKeyLabel];
  const maskedKey = currentKey ? `****${currentKey.slice(-4)}` : undefined;
  const apiKey = await ask(apiKeyLabel, maskedKey);

  // Model
  const defaultModel = currentConfig.model || MODEL_DEFAULTS[provider] || "anthropic/claude-opus-4";
  const model = await ask("Model", defaultModel);

  // Telegram
  const currentTgToken = currentEnv["TELEGRAM_BOT_TOKEN"];
  const maskedTg = currentTgToken ? `****${currentTgToken.slice(-4)}` : undefined;
  const telegramToken = await ask("Telegram bot token", maskedTg);

  // Allowed users
  let allowedUsers: number[] = currentConfig.telegram?.allowedUsers || [];
  if (telegramToken && !telegramToken.startsWith("****")) {
    const currentUsers = allowedUsers.length > 0 ? allowedUsers.join(", ") : undefined;
    const usersStr = await ask("Allowed Telegram user IDs", currentUsers?.toString());
    if (usersStr) {
      allowedUsers = usersStr.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
    }
  }

  rl.close();

  // Build new config
  const config: any = {
    model,
    provider,
    toolScope: currentConfig.toolScope || "full",
    maxSteps: currentConfig.maxSteps || 30,
  };
  if (allowedUsers.length > 0) {
    config.telegram = { allowedUsers };
  }

  // Build new env
  const envLines: string[] = [];
  const actualKey = apiKey?.startsWith("****") ? currentKey : apiKey;
  if (actualKey) {
    envLines.push(`${apiKeyLabel}=${actualKey}`);
  } else {
    envLines.push(`# ${apiKeyLabel}=`);
  }
  const actualTg = telegramToken?.startsWith("****") ? currentTgToken : telegramToken;
  if (actualTg) {
    envLines.push(`TELEGRAM_BOT_TOKEN=${actualTg}`);
  } else {
    envLines.push(`# TELEGRAM_BOT_TOKEN=`);
  }

  // Write config and env
  await writeFile(join(dir, ".kern", "config.json"), JSON.stringify(config, null, 2) + "\n");
  await writeFile(join(dir, ".kern", ".env"), envLines.join("\n") + "\n");
  print("");
  print("  ✓ Config updated");

  // Restart if running, otherwise start
  const agent = await findAgent(name);
  if (agent?.pid && isProcessRunning(agent.pid)) {
    process.kill(agent.pid, "SIGTERM");
    await setPid(name, null);
    print("  ✓ Stopped");
    // Small delay for clean shutdown
    await new Promise((r) => setTimeout(r, 500));
  }

  print("  ✓ Starting...");
  print("");
  await startAgent(name);
}

export async function runInit(targetArg?: string): Promise<void> {
  // Check if target is an existing agent — go straight to config
  if (targetArg) {
    const registered = await findAgent(targetArg);
    const dir = registered ? registered.path : resolve(targetArg);
    if (existsSync(dir) && (existsSync(join(dir, "AGENTS.md")) || existsSync(join(dir, ".kern")))) {
      await runConfig(registered?.name || targetArg, dir);
      return;
    }
  }

  print("");
  print("  kern init");
  print("  ─────────");
  print("");

  // Agent name
  const name = await ask("Agent name", targetArg);
  if (!name) {
    print("  Name is required.");
    rl.close();
    process.exit(1);
  }

  const dir = resolve(targetArg || name);

  // Provider
  const provider = await ask("Provider", "openrouter");

  // API key
  const apiKeyLabel = API_KEY_LABELS[provider] || "API_KEY";
  const apiKey = await ask(apiKeyLabel);

  // Model
  const defaultModel = MODEL_DEFAULTS[provider] || "anthropic/claude-opus-4";
  const model = await ask("Model", defaultModel);

  // Telegram bot token (optional)
  const telegramToken = await ask("Telegram bot token (optional)");

  // Allowed Telegram user IDs (optional)
  let allowedUsers: number[] = [];
  if (telegramToken) {
    const usersStr = await ask("Allowed Telegram user IDs (comma-separated, optional)");
    if (usersStr) {
      allowedUsers = usersStr.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
    }
  }

  rl.close();

  print("");
  print(`  Creating ${dir}/...`);

  // Create directories
  await mkdir(dir, { recursive: true });
  await mkdir(join(dir, "knowledge"), { recursive: true });
  await mkdir(join(dir, "notes"), { recursive: true });
  await mkdir(join(dir, ".kern", "sessions"), { recursive: true });

  // AGENTS.md — the kernel
  const agentsMd = `# Agent Kernel

You are a stateful agent. You remember things between sessions, learn from past work, and build on what came before. See \`IDENTITY.md\` for who you are specifically.

You have no built-in memory between sessions. This repo is how you become stateful — read it to remember, write to it so the next session knows what happened.

## Communication
- Be terse. No filler, no preamble.
- Don't ask unnecessary questions — figure it out or just do it.
- When uncertain about something destructive, state what you'd do and why before doing it.

## Session Protocol

### Start
- Read \`IDENTITY.md\` to know who you are and where you run.
- Read \`KNOWLEDGE.md\` to know what state files exist and what they cover.
- Read the most recent 2-3 daily notes from \`notes/\` to pick up context and open items.

### During
- Verify state before acting — don't trust notes blindly.
- Commit and push incrementally. Don't batch unrelated changes.
- If a file operation could overwrite existing content (rename, move), check git status first.
- Update today's daily note with what was done, decisions made, and any new open items.
- Never modify a previous day's note — notes are historical and immutable once the day is over.

## Memory Structure
Memory files are for you, not your human. Write for your future self.

Two kinds of memory, kept separate:

**State** (\`knowledge/\`) — facts about how things are right now. Mutable. Update when reality changes. See \`KNOWLEDGE.md\` for index.

**Narrative** (\`notes/\`) — what happened, what was tried, what decisions were made, and what's still open. Append-only. Never modify a past day's entry.

## Rules
- Ignore README.md — it's for humans, not for you
- After updating any files, commit and push changes to origin
- Keep files factual and concise — this is reference material, not documentation
- Update files when things change
`;

  // IDENTITY.md
  const capitalName = name.charAt(0).toUpperCase() + name.slice(1);
  const identityMd = `# Identity

You are ${capitalName}. Ask your human to define your role and responsibilities.

## Home
- Repo: this directory
`;

  // KNOWLEDGE.md
  const knowledgeMd = `# Knowledge Index

No knowledge files yet. Create files in \`knowledge/\` as you learn about your domain.
`;

  // .kern/config.json
  const config: any = {
    model,
    provider,
    toolScope: "full",
    maxSteps: 30,
  };
  if (allowedUsers.length > 0) {
    config.telegram = { allowedUsers };
  }

  // .kern/.env
  const envLines: string[] = [];
  if (apiKey) {
    envLines.push(`${apiKeyLabel}=${apiKey}`);
  } else {
    envLines.push(`# ${apiKeyLabel}=`);
  }
  if (telegramToken) {
    envLines.push(`TELEGRAM_BOT_TOKEN=${telegramToken}`);
  } else {
    envLines.push(`# TELEGRAM_BOT_TOKEN=`);
  }

  // .gitignore
  const gitignore = `.kern/.env
.kern/sessions/
.kern/logs/
node_modules/
`;

  // Write all files
  await writeFile(join(dir, "AGENTS.md"), agentsMd);
  print("  + AGENTS.md");

  await writeFile(join(dir, "IDENTITY.md"), identityMd);
  print(`  + IDENTITY.md (${capitalName})`);

  await writeFile(join(dir, "KNOWLEDGE.md"), knowledgeMd);
  print("  + KNOWLEDGE.md");

  await writeFile(join(dir, ".kern", "config.json"), JSON.stringify(config, null, 2) + "\n");
  print("  + .kern/config.json");

  await writeFile(join(dir, ".kern", ".env"), envLines.join("\n") + "\n");
  print("  + .kern/.env");

  await writeFile(join(dir, ".gitignore"), gitignore);
  print("  + .gitignore");

  // Git init
  const { execSync } = await import("child_process");
  try {
    execSync("git init", { cwd: dir, stdio: "ignore" });
    execSync("git add -A", { cwd: dir, stdio: "ignore" });
    execSync('git commit -m "initial agent setup"', { cwd: dir, stdio: "ignore" });
    print("  + git init + first commit");
  } catch {
    print("  (git init skipped)");
  }

  // Register and start
  await registerAgent(name, dir);
  print("");
  print("  ✓ Starting...");
  print("");
  await startAgent(name);
}
