# kern

Agents that do the work and show it.

One brain across every channel. Your agent sits in Slack channels, Telegram DMs, the terminal, and the browser — one continuous session, nothing lost. It uses real tools, remembers everything, and publishes its own dashboards.

![kern web UI](https://kern-ai.com/images/agent-intranet.png)

## Why kern

- **One brain, every channel** — terminal, browser, Telegram, Slack feed into one session. The agent knows who's talking, what channel it's in, and what happened 10,000 messages ago.
- **Memory that compounds** — conversations segmented by topic, summarized into a hierarchy, compressed into context. Semantic recall over everything. The agent gets better the longer it runs.
- **Your infra, your data** — runs on your laptop, server, or homelab. The whole agent is a git-tracked folder. Pay only for API tokens — or use Ollama for fully local, zero-cost inference.

kern pairs with [agent-kernel](https://github.com/oguzbilgic/agent-kernel) — the kernel defines how an agent remembers, kern runs it.

## Quick start

```bash
npm install -g kern-ai
kern init my-agent
kern tui
```

The init wizard scaffolds your agent, asks for a provider and API key, then starts it. `kern tui` opens an interactive chat. `kern web start` serves the UI in the browser.

For automation: `kern init my-agent --api-key sk-or-...` (no prompts, defaults to openrouter + opus 4.6). For Ollama: `kern init my-agent --provider ollama --api-key http://localhost:11434 --model gemma4:31b`.

## How it works

```
Terminal ─────┐
Web UI ───────┤
Telegram ─────┤── one session ── one folder
Slack ────────┘
```

Every interface feeds into the same session. The agent reads and writes its own memory files through tools — takes notes, updates knowledge, commits to git. The next time you talk to it, from any interface, it picks up exactly where it left off.

## What ships today

| Feature | Description |
|---------|-------------|
| **Agent-built dashboards** | Agents create HTML dashboards with live data injection, rendered in a side panel or inline in chat |
| **Multi-modal** | Images, PDFs, files across every channel. Vision pre-digest, PDF extraction, dedicated analysis tools |
| **Desktop app** | Native macOS via Tauri. Tray icon, Cmd+1-9 agent switching, direct connections |
| **Prompt caching** | Three cache breakpoints. 99% mid-turn hits, 10x cost reduction. Automatic for Anthropic |
| **React web UI** | Flat and bubble layouts, syntax highlighting, infinite scroll, multi-agent sidebar with live status |
| **Real tools** | bash, read, write, edit, grep, webfetch, websearch, pdf, image, render — full system access |
| **4 providers** | OpenRouter, Anthropic, OpenAI, Ollama. Mix models per role — chat, embeddings, summaries, vision |
| **Plugin architecture** | Dashboard, media, recall, notes extracted as plugins with lifecycle hooks |
| **Heartbeat** | Agents wake periodically to review notes, update knowledge, and reach out if needed |

## Agent structure

```
my-agent/
  AGENTS.md              # how the agent behaves (system prompt)
  IDENTITY.md            # who the agent is
  KNOWLEDGE.md           # index of what it knows
  USERS.md               # paired users with roles and guardrails
  knowledge/             # mutable state files
  notes/                 # daily logs (append-only)
  dashboards/            # agent-built dashboards
  .kern/
    config.json          # model, provider, toolScope
    .env                 # API keys, bot tokens (gitignored)
    sessions/            # conversation history (gitignored)
    recall.db            # memory database (gitignored)
```

Everything the agent needs is in this folder. Move it, zip it, clone it — the agent comes with it.

## Memory

![Memory UI — Segments](https://kern-ai.com/images/segments-2.png)

Agents remember across sessions through three mechanisms:

- **Files** — `knowledge/` for mutable state, `notes/` for daily logs. Git-tracked, inspectable, portable.
- **Recall** — semantic search over all past conversations via local SQLite + embeddings.
- **Segments** — messages grouped by topic, summarized into a hierarchy (L0 → L1 → L2), compressed into context when old messages are trimmed.

The web UI includes a Memory overlay with five tabs for examining sessions, segments, notes, recall, and the full context pipeline.

## Dashboards

Agents create and maintain their own dashboards — HTML pages with structured data, served from the agent and displayed in the web UI side panel.

```
dashboards/homelab/
  index.html       # visualization
  data.json        # structured data (injected as window.__KERN_DATA__)
  refresh.sh       # update script
```

The agent writes `data.json`, creates the HTML, then calls `render({ dashboard: "homelab" })` to display it. Dashboards appear in the sidebar and can be switched from the panel header.

See [Dashboards docs](docs/dashboards.md) for the full file contract, data injection, refresh scripts, and examples.

## CLI

```bash
kern init <name>          # create or configure an agent
kern start [name|path]    # start agents in background
kern stop [name]          # stop agents
kern restart [name]       # restart agents
kern install [name|--web|--proxy] # install systemd services
kern tui [name]           # interactive chat
kern web <start|stop>     # static web UI server
kern proxy <start|stop|token>  # authenticated reverse proxy
kern logs [name]          # follow agent logs
kern list                 # show all agents and services
kern backup <name>        # backup agent to .tar.gz
```

### Connecting

Agents bind to `0.0.0.0` on sticky ports (4100-4999), accessible over Tailscale or LAN. The web UI connects directly — enter the agent's URL and `KERN_AUTH_TOKEN` in the sidebar.

Optionally, `kern proxy start` launches an authenticated reverse proxy that discovers and forwards to local agents.

### Slash commands

```
/status     # agent status, model, uptime, session size
/restart    # restart the agent daemon
/help       # list available commands
```

## Interfaces

| Interface | Setup |
|-----------|-------|
| **Terminal** | `kern tui` — interactive chat |
| **Web UI** | `kern web start` — browser at port 8080 |
| **Telegram** | Set `TELEGRAM_BOT_TOKEN` in `.kern/.env` |
| **Slack** | Set `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN` in `.kern/.env` |
| **Desktop** | macOS app via Tauri ([releases](https://github.com/oguzbilgic/kern-ai/releases)) |

First Telegram/Slack user is auto-paired as operator. Others pair with `KERN-XXXX` codes.

## Configuration

### `.kern/config.json`

```json
{
  "model": "anthropic/claude-opus-4.6",
  "provider": "openrouter",
  "toolScope": "full",
  "maxContextTokens": 100000,
  "summaryBudget": 0.75
}
```

### Tool scopes

- **full** — shell, read, write, edit, glob, grep, webfetch, websearch, kern, message, recall, pdf, image, render
- **write** — everything except shell
- **read** — read-only tools

### Providers

| Provider | Description |
|----------|-------------|
| **openrouter** | Any model via OpenRouter (default) |
| **anthropic** | Direct Anthropic API |
| **openai** | OpenAI / Azure |
| **ollama** | Local models via [Ollama](https://ollama.com) |

Models can be mixed per role: `model` for chat, `embeddingModel` for recall, `summaryModel` for segments, `mediaModel` for vision.

## Documentation

- [Get started](docs/get-started.md)
- [Configuration](docs/config.md)
- [Architecture](docs/architecture.md)
- [Memory](docs/memory.md)
- [Dashboards](docs/dashboards.md)
- [Context & segments](docs/context.md)
- [Prompt caching](docs/caching.md)
- [Media](docs/media.md)
- [Tools](docs/tools.md)
- [Interfaces](docs/interfaces.md)
- [CLI commands](docs/commands.md)
- [Pairing](docs/pairing.md)

## Built with

- [Vercel AI SDK](https://sdk.vercel.ai) — model-agnostic AI layer
- [grammY](https://grammy.dev) — Telegram bot framework
- [@slack/bolt](https://slack.dev/bolt-js) — Slack bot framework
- [agent-kernel](https://github.com/oguzbilgic/agent-kernel) — the memory pattern

## License

MIT
