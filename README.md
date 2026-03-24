# kern

One agent. One folder. One continuous conversation.

kern is a simple agent runtime where each agent lives in a single directory — its identity, memory, config, and conversation all in one place. No server, no database, no multi-tenant complexity. Just a folder and a persistent session.

## Why kern

Most agent frameworks give you sessions that reset, memory that's a black box, or infrastructure you have to manage. kern takes a different approach:

- **Single session per agent** — one continuous conversation that persists as a plain JSONL file. Resume where you left off, every time.
- **A folder is the agent** — AGENTS.md defines behavior, IDENTITY.md defines who it is, knowledge/ and notes/ are its memory. Everything is plain text, git-tracked, and inspectable.
- **No infra** — no server, no database, no vector store. A folder, an API key, and `npx kern-ai`.
- **Model-agnostic** — OpenRouter, Anthropic, OpenAI. Swap providers in one config line.
- **Messaging built in** — Telegram today, Slack next. Talk to your agent from your phone.

kern pairs with [agent-kernel](https://github.com/oguzbilgic/agent-kernel) — the kernel defines how an agent remembers, kern runs it.

## Quick start

```bash
npx kern-ai init my-agent
cd my-agent
npx kern-ai
```

The init wizard asks for a provider, API key, and model — then scaffolds a ready-to-run agent.

## How it works

```
You (CLI or Telegram)
  → kern runtime
    → Vercel AI SDK (model-agnostic)
      → tools execute (bash, read, write, edit, glob, grep)
    → response streams back
  → conversation saved to .kern/sessions/
```

The agent reads and writes its own memory files through tools. It takes notes, updates knowledge, commits to git — all on its own. The next time you start a conversation, it picks up exactly where it left off.

## Agent structure

After `kern-ai init`, your agent directory looks like:

```
my-agent/
  AGENTS.md              # how the agent behaves (system prompt)
  IDENTITY.md            # who the agent is
  KNOWLEDGE.md           # index of what it knows
  knowledge/             # mutable state files
  notes/                 # daily logs (append-only)
  .kern/
    config.json          # model, provider, tools (committed)
    .env                 # API keys, bot tokens (gitignored)
    sessions/            # conversation history (gitignored)
```

Everything the agent needs is in this folder. Move it, zip it, clone it — the agent comes with it.

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

## CLI

```bash
npx kern-ai init <name>     # create a new agent
npx kern-ai <dir>           # run agent in directory
npx kern-ai                 # run in current directory
```

## Telegram

Set `TELEGRAM_BOT_TOKEN` in `.kern/.env` and kern connects via long polling. No public URL needed — works behind NAT.

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
