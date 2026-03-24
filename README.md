# kern

One agent. One folder. One continuous conversation.

kern gives an AI agent a single mind — one continuous session shared across CLI, Telegram, and Slack. Identity, memory, and conversation live in a plain folder. No server, no database. Just `npx kern-ai`.

## Why kern

Most agent frameworks give you sessions that reset, memory that's a black box, or infrastructure you have to manage. kern takes a different approach:

- **One brain** — a single continuous session across every interface. Message from Telegram, pick up in the CLI, continue in Slack. The agent always knows what happened.
- **Context-aware** — the agent knows who's talking and where. It sees the user, the channel, and the interface — so it can adjust tone, filter context, and keep track of different conversations within the same session.
- **A folder is the agent** — AGENTS.md defines behavior, IDENTITY.md defines who it is, knowledge/ and notes/ are its memory. Everything is plain text, git-tracked, and inspectable.
- **No infra** — no server, no database, no vector store. A folder, an API key, and `npx kern-ai`.

kern pairs with [agent-kernel](https://github.com/oguzbilgic/agent-kernel) — the kernel defines how an agent remembers, kern runs it.

## Quick start

```bash
npx kern-ai init my-agent
npx kern-ai start my-agent
```

The init wizard asks for a provider, API key, and model — then scaffolds and starts your agent.

## How it works

```
Terminal ─────────┐
Telegram DM ──────┤── kern ── one session ── one folder
#engineering ─────┤
Slack DM ─────────┘
```

Every interface feeds into the same session. The agent reads and writes its own memory files through tools — takes notes, updates knowledge, commits to git. The next time you talk to it, from any interface, it picks up exactly where it left off.

## Agent structure

After `kern init`, your agent directory looks like:

```
my-agent/
  AGENTS.md              # how the agent behaves (system prompt)
  IDENTITY.md            # who the agent is
  KNOWLEDGE.md           # index of what it knows
  knowledge/             # mutable state files
  notes/                 # daily logs (append-only)
  .kern/
    config.json          # model, provider, toolScope (committed)
    .env                 # API keys, bot tokens (gitignored)
    sessions/            # conversation history (gitignored)
```

Everything the agent needs is in this folder. Move it, zip it, clone it — the agent comes with it.

## CLI

```bash
kern init <name>          # create a new agent
kern start [name|path]    # start agents (all if no name)
kern stop [name]          # stop agents (all if no name)
kern list                 # show all agents
kern run <name|path>      # run in foreground (dev/debug)
```

Agents auto-register when you init, start, or run them. `kern list` shows every agent kern knows about.

## Configuration

`.kern/config.json`:

```json
{
  "model": "anthropic/claude-opus-4",
  "provider": "openrouter",
  "toolScope": "full",
  "maxSteps": 30
}
```

`.kern/.env`:

```
OPENROUTER_API_KEY=sk-or-...
TELEGRAM_BOT_TOKEN=...
```

### Tool scopes

- **full** — bash, read, write, edit, glob, grep, webfetch, kern
- **write** — read, write, edit, glob, grep, webfetch, kern
- **read** — read, glob, grep, webfetch, kern

### Providers

- **openrouter** — any model via OpenRouter (default)
- **anthropic** — direct Anthropic API
- **openai** — OpenAI / Azure

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
