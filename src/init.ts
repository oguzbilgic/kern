import { mkdir, writeFile, readFile } from "fs/promises";
import { join, resolve } from "path";
import { existsSync } from "fs";
import { input, select, password } from "@inquirer/prompts";
import { registerAgent, findAgent, isProcessRunning, setPid } from "./registry.js";
import { startAgent } from "./daemon.js";

const MODELS: Record<string, { name: string; value: string }[]> = {
  openrouter: [
    { name: "Claude Opus 4.6", value: "anthropic/claude-opus-4.6" },
    { name: "Claude Sonnet 4.6", value: "anthropic/claude-sonnet-4.6" },
    { name: "MiMo-V2-Pro", value: "xiaomi/mimo-v2-pro" },
    { name: "MiniMax M2.5", value: "minimax/minimax-m2.5" },
    { name: "DeepSeek V3.2", value: "deepseek/deepseek-chat-v3.2" },
    { name: "GLM 5 Turbo", value: "z-ai/glm-5-turbo" },
    { name: "Gemini 3 Flash Preview", value: "google/gemini-3-flash-preview" },
    { name: "Hunter Alpha", value: "openrouter/hunter-alpha" },
    { name: "GPT-5.4", value: "openai/gpt-5.4" },
    { name: "Gemini 3.1 Pro", value: "google/gemini-3.1-pro" },
    { name: "Gemini 2.5 Flash", value: "google/gemini-2.5-flash" },
    { name: "Step 3.5 Flash (free)", value: "stepfun/step-3.5-flash" },
  ],
  anthropic: [
    { name: "Claude Opus 4.6", value: "claude-opus-4-6-20260301" },
    { name: "Claude Sonnet 4.6", value: "claude-sonnet-4-6-20260301" },
  ],
  openai: [
    { name: "GPT-4o", value: "gpt-4o" },
    { name: "GPT-4.1", value: "gpt-4.1" },
    { name: "o3", value: "o3" },
  ],
};

const PROVIDERS = [
  { name: "OpenRouter", value: "openrouter", keyLabel: "OpenRouter API key" },
  { name: "Anthropic", value: "anthropic", keyLabel: "Anthropic API key" },
  { name: "OpenAI", value: "openai", keyLabel: "OpenAI API key" },
];

const API_KEY_ENV: Record<string, string> = {
  openrouter: "OPENROUTER_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
};

function print(text: string) {
  console.log(text);
}

async function runConfig(name: string, dir: string): Promise<void> {
  print("");
  print(`  kern config — ${name}`);
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
  const provider = await select({
    message: "Provider",
    choices: PROVIDERS.map((p) => ({ name: p.name, value: p.value })),
    default: currentConfig.provider || "openrouter",
  });

  // API key
  const providerInfo = PROVIDERS.find((p) => p.value === provider)!;
  const envVar = API_KEY_ENV[provider];
  const currentKey = currentEnv[envVar];
  const maskedKey = currentKey ? `****${currentKey.slice(-4)}` : "";

  const apiKeyMsg = maskedKey ? `${providerInfo.keyLabel} (${maskedKey}, enter to keep)` : providerInfo.keyLabel;
  const apiKey = await password({
    message: apiKeyMsg,
    mask: "*",
  });

  // Model
  const modelChoices = MODELS[provider] || MODELS.openrouter;
  const currentModel = currentConfig.model || modelChoices[0].value;
  const model = await select({
    message: "Model",
    choices: modelChoices,
    default: currentModel,
  });

  // Telegram
  const currentTgToken = currentEnv["TELEGRAM_BOT_TOKEN"];
  const maskedTg = currentTgToken ? `****${currentTgToken.slice(-4)}` : "";
  const tgMsg = maskedTg ? `Telegram bot token (${maskedTg}, enter to keep)` : "Telegram bot token";
  const telegramToken = await password({
    message: tgMsg,
    mask: "*",
  });

  // Slack
  const currentSlackBot = currentEnv["SLACK_BOT_TOKEN"];
  const maskedSlackBot = currentSlackBot ? `****${currentSlackBot.slice(-4)}` : "";
  const slackBotMsg = maskedSlackBot ? `Slack bot token (${maskedSlackBot}, enter to keep)` : "Slack bot token (xoxb-...)";
  const slackBotToken = await password({
    message: slackBotMsg,
    mask: "*",
  });

  const currentSlackApp = currentEnv["SLACK_APP_TOKEN"];
  const maskedSlackApp = currentSlackApp ? `****${currentSlackApp.slice(-4)}` : "";
  let slackAppToken = "";
  if (slackBotToken || currentSlackBot) {
    const slackAppMsg = maskedSlackApp ? `Slack app token (${maskedSlackApp}, enter to keep)` : "Slack app token (xapp-...)";
    slackAppToken = await password({
      message: slackAppMsg,
      mask: "*",
    });
  }

  // Build new config
  const config: any = {
    model,
    provider,
    toolScope: currentConfig.toolScope || "full",
    maxSteps: currentConfig.maxSteps || 30,
  };
  // Build new env
  const envLines: string[] = [];
  const actualKey = !apiKey ? currentKey : apiKey;
  if (actualKey) {
    envLines.push(`${envVar}=${actualKey}`);
  } else {
    envLines.push(`# ${envVar}=`);
  }
  const actualTg = !telegramToken ? currentTgToken : telegramToken;
  if (actualTg) {
    envLines.push(`TELEGRAM_BOT_TOKEN=${actualTg}`);
  } else {
    envLines.push(`# TELEGRAM_BOT_TOKEN=`);
  }
  const actualSlackBot = !slackBotToken ? currentSlackBot : slackBotToken;
  if (actualSlackBot) {
    envLines.push(`SLACK_BOT_TOKEN=${actualSlackBot}`);
  } else {
    envLines.push(`# SLACK_BOT_TOKEN=`);
  }
  const actualSlackApp = !slackAppToken ? currentSlackApp : slackAppToken;
  if (actualSlackApp) {
    envLines.push(`SLACK_APP_TOKEN=${actualSlackApp}`);
  } else {
    envLines.push(`# SLACK_APP_TOKEN=`);
  }

  // Write
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
    await new Promise((r) => setTimeout(r, 500));
  }

  print("  ✓ Starting...");
  print("");
  await startAgent(name);
}

export async function runInit(targetArg?: string, flags?: Record<string, string>): Promise<void> {
  // Check if target is an existing agent — go straight to config
  if (targetArg && !flags) {
    const registered = await findAgent(targetArg);
    const dir = registered ? registered.path : resolve(targetArg);
    if (existsSync(dir) && (existsSync(join(dir, "AGENTS.md")) || existsSync(join(dir, ".kern")))) {
      await runConfig(registered?.name || targetArg, dir);
      return;
    }
  }

  // Non-interactive mode
  if (flags && flags["api-key"]) {
    const name = targetArg;
    if (!name) {
      console.error("Usage: kern init <name> --api-key <key>");
      process.exit(1);
    }

    const provider = flags.provider || "openrouter";
    const model = flags.model || (MODELS[provider]?.[0]?.value || "anthropic/claude-opus-4.6");
    const apiKey = flags["api-key"];
    const envVar = API_KEY_ENV[provider] || "OPENROUTER_API_KEY";
    const telegramToken = flags["telegram-token"] || "";
    const slackBotToken = flags["slack-bot-token"] || "";
    const slackAppToken = flags["slack-app-token"] || "";
    const dir = resolve(name);

    await scaffoldAgent({
      name, dir, provider, model, apiKey, envVar,
      telegramToken, slackBotToken, slackAppToken,
    });
    return;
  }

  // Interactive mode
  print("");
  print("  kern init");
  print("");

  // Agent name
  const name = await input({
    message: "Agent name",
    default: targetArg,
    required: true,
  });

  const dir = resolve(targetArg || name);

  // Provider
  const provider = await select({
    message: "Provider",
    choices: PROVIDERS.map((p) => ({ name: p.name, value: p.value })),
    default: "openrouter",
  });

  // API key
  const providerInfo = PROVIDERS.find((p) => p.value === provider)!;
  const envVar = API_KEY_ENV[provider];
  const apiKey = await password({
    message: providerInfo.keyLabel,
    mask: "*",
  });

  // Model
  const modelChoices = MODELS[provider] || MODELS.openrouter;
  const model = await select({
    message: "Model",
    choices: modelChoices,
    default: modelChoices[0].value,
  });

  // Telegram bot token (optional)
  const telegramToken = await password({
    message: "Telegram bot token (optional)",
    mask: "*",
  });

  // Slack (optional)
  const slackBotToken = await password({
    message: "Slack bot token (optional, xoxb-...)",
    mask: "*",
  });

  let slackAppToken = "";
  if (slackBotToken) {
    slackAppToken = await password({
      message: "Slack app token (xapp-...)",
      mask: "*",
    });
  }

  await scaffoldAgent({
    name, dir, provider, model, apiKey, envVar,
    telegramToken, slackBotToken, slackAppToken,
  });
}

interface ScaffoldOpts {
  name: string;
  dir: string;
  provider: string;
  model: string;
  apiKey: string;
  envVar: string;
  telegramToken: string;
  slackBotToken: string;
  slackAppToken: string;
}

async function scaffoldAgent(opts: ScaffoldOpts): Promise<void> {
  const { name, dir, provider, model, apiKey, envVar, telegramToken, slackBotToken, slackAppToken } = opts;

  const dirExists = existsSync(dir);
  print("");
  print(dirExists ? `  Adding kern to ${dir}/...` : `  Creating ${dir}/...`);

  // Create directories
  await mkdir(dir, { recursive: true });
  await mkdir(join(dir, "knowledge"), { recursive: true });
  await mkdir(join(dir, "notes"), { recursive: true });
  await mkdir(join(dir, ".kern", "sessions"), { recursive: true });

  // AGENTS.md — the kernel
  // Load bundled AGENTS.md
  const agentsMd = await readFile(join(import.meta.dirname, "..", "AGENTS.md"), "utf-8");

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
  // .kern/.env
  const envLines: string[] = [];
  if (apiKey) {
    envLines.push(`${envVar}=${apiKey}`);
  } else {
    envLines.push(`# ${envVar}=`);
  }
  if (telegramToken) {
    envLines.push(`TELEGRAM_BOT_TOKEN=${telegramToken}`);
  } else {
    envLines.push(`# TELEGRAM_BOT_TOKEN=`);
  }
  if (slackBotToken) {
    envLines.push(`SLACK_BOT_TOKEN=${slackBotToken}`);
  } else {
    envLines.push(`# SLACK_BOT_TOKEN=`);
  }
  if (slackAppToken) {
    envLines.push(`SLACK_APP_TOKEN=${slackAppToken}`);
  } else {
    envLines.push(`# SLACK_APP_TOKEN=`);
  }

  // .gitignore
  const gitignore = `.kern/.env
.kern/sessions/
.kern/logs/
node_modules/
`;

  // Write files — only create if they don't exist (except .kern/ which always gets written)
  if (!existsSync(join(dir, "AGENTS.md"))) {
    await writeFile(join(dir, "AGENTS.md"), agentsMd);
    print("  + AGENTS.md");
  } else {
    print("  ○ AGENTS.md (exists)");
  }

  if (!existsSync(join(dir, "IDENTITY.md"))) {
    await writeFile(join(dir, "IDENTITY.md"), identityMd);
    print(`  + IDENTITY.md (${capitalName})`);
  } else {
    print("  ○ IDENTITY.md (exists)");
  }

  if (!existsSync(join(dir, "KNOWLEDGE.md"))) {
    await writeFile(join(dir, "KNOWLEDGE.md"), knowledgeMd);
    print("  + KNOWLEDGE.md");
  } else {
    print("  ○ KNOWLEDGE.md (exists)");
  }

  if (!existsSync(join(dir, "USERS.md"))) {
    await writeFile(join(dir, "USERS.md"), `# Users\n\nNo paired users yet. Users pair via Telegram with a pairing code.\n`);
    print("  + USERS.md");
  } else {
    print("  ○ USERS.md (exists)");
  }

  // .kern/ config always written (new agent or adopt)
  await writeFile(join(dir, ".kern", "config.json"), JSON.stringify(config, null, 2) + "\n");
  print("  + .kern/config.json");

  await writeFile(join(dir, ".kern", ".env"), envLines.join("\n") + "\n");
  print("  + .kern/.env");

  if (!existsSync(join(dir, ".gitignore"))) {
    await writeFile(join(dir, ".gitignore"), gitignore);
    print("  + .gitignore");
  } else {
    print("  ○ .gitignore (exists)");
  }

  // Git init only for new repos
  if (!existsSync(join(dir, ".git"))) {
    const { execSync } = await import("child_process");
    try {
      execSync("git init", { cwd: dir, stdio: "ignore" });
      execSync("git add -A", { cwd: dir, stdio: "ignore" });
      execSync('git commit -m "initial agent setup"', { cwd: dir, stdio: "ignore" });
      print("  + git init + first commit");
    } catch {
      print("  (git init skipped)");
    }
  } else {
    print("  ○ git repo (exists)");
  }

  // Register and start
  await registerAgent(name, dir);
  print("");
  print("  ✓ Starting...");
  print("");
  await startAgent(name);
}
