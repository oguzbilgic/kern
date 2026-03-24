# kern

Simple agent runtime. Give any AI agent persistent memory and a Telegram interface.

kern pairs with [agent-kernel](https://github.com/oguzbilgic/agent-kernel) — the kernel defines how an agent remembers, kern runs it.

## Quick start

```bash
npx kern-ai init my-agent
cd my-agent
npx kern-ai
```

The init wizard asks for a provider, API key, and model — then scaffolds an agent with persistent memory.

## What it does

- **Runs an AI agent** with tools (bash, file read/write/edit, glob, grep)
- **Persists conversation** as JSONL — sessions resume where they left off
- **Streams responses** to the terminal with a live TUI
- **Reads AGENTS.md** as system prompt — the agent-kernel pattern for stateful agents
- **Connects to Telegram** (optional) — message your agent from anywhere

## How it works

```
You (CLI or Telegram)
  → kern runtime
    → Vercel AI SDK (model-agnostic)
      → tools execute (bash, read, write, edit, glob, grep)
    → response streams back
  → conversation saved to .kern/sessions/
```

The agent's memory lives in the repo — AGENTS.md, IDENTITY.md, KNOWLEDGE.md, knowledge/, notes/. The agent reads and writes these files through tools. Everything is plain text and git-tracked.

## Project structure

After `kern init`, your agent directory looks like:

```
my-agent/
  AGENTS.md              # agent kernel — how the agent behaves
  IDENTITY.md            # who the agent is
  KNOWLEDGE.md           # index of knowledge files
  knowledge/             # mutable state files
  notes/                 # daily logs (append-only)
  .kern/
    config.json          # model, provider, tools (committed)
    .env                 # API keys, bot tokens (gitignored)
    sessions/            # conversation history (gitignored)
```

## Configuration

`.kern/config.json`:

```json
{
  "model": "anthropic/claude-opus-4",
  "provider": "openrouter",
  "tools": ["bash", "read", "write", "edit", "glob", "grep"],
  "maxSteps": 30
}
```

`.kern/.env`:

```
OPENROUTER_API_KEY=sk-or-...
TELEGRAM_BOT_TOKEN=...
```

## Providers

- **openrouter** — any model via OpenRouter (default)
- **anthropic** — direct Anthropic API
- **openai** — OpenAI / Azure

## CLI usage

```bash
npx kern-ai init <name>     # create a new agent
npx kern-ai <dir>           # run agent in directory
npx kern-ai                 # run agent in current directory
```

## Telegram

Set `TELEGRAM_BOT_TOKEN` in `.kern/.env` and kern automatically connects via long polling. No public URL needed — works behind NAT.

Optional: restrict access with allowed user IDs in `.kern/config.json`:

```json
{
  "telegram": {
    "allowedUsers": [123456789]
  }
}
```

## Built with

- [Vercel AI SDK](https://sdk.vercel.ai) — model-agnostic AI layer
- [grammY](https://grammy.dev) — Telegram bot framework
- [agent-kernel](https://github.com/oguzbilgic/agent-kernel) — the memory pattern

## License

MIT
