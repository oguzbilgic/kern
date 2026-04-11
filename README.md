# kern

Agents that do the work and show it.

One brain across every channel. Your agent sits in Slack channels, Telegram DMs, the terminal, and the browser — one continuous session, nothing lost. It uses real tools, remembers everything, and publishes its own dashboards.

![kern web UI](https://kern-ai.com/images/agent-intranet.png)

## Why kern

- **One brain, every channel** — terminal, browser, Telegram, Slack feed into one session. The agent knows who's talking, what channel it's in, and what happened 10,000 messages ago.
- **Memory that compounds** — conversations segmented by topic, summarized into a hierarchy, compressed into context. Semantic recall over everything. The agent gets better the longer it runs.
- **Agents build their own UI** — dashboards with live data, served from the agent, displayed in a side panel. Not chat — real interfaces that update themselves.
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

## Dashboards

Agents create and maintain their own dashboards — HTML pages with live data, served from the agent and displayed in the web UI side panel. Not chat transcripts. Real interfaces that update themselves.

```
dashboards/homelab/
  index.html       # visualization
  data.json        # structured data (injected as window.__KERN_DATA__)
```

The agent writes `data.json`, creates the HTML, then calls `render({ dashboard: "homelab" })` to display it. Dashboards appear in the sidebar and can be switched from the panel header.

[Dashboards docs](docs/dashboards.md) · [Blog: Why every agent needs a dashboard](https://kern-ai.com/blog/agent-dashboards)

## Memory

![Memory UI — Segments](https://kern-ai.com/images/segments-2.png)

Conversations are automatically segmented by topic, summarized, and rolled up into a hierarchy (L0 → L1 → L2). When old messages are trimmed from context, compressed summaries take their place — the agent sees its full history at decreasing resolution. Semantic recall searches everything.

The web UI includes a Memory overlay with five tabs for inspecting sessions, segments, notes, recall, and the full context pipeline with token breakdowns.

[Memory docs](docs/memory.md) · [Blog: Lossless context management](https://kern-ai.com/blog/lossless-context-management) · [Blog: See inside your agent's brain](https://kern-ai.com/blog/memory-ui)

## One session

```
Terminal ─────┐
Web UI ───────┤
Telegram ─────┤── one session
Slack ────────┘
```

Every interface feeds into the same session. Message from Telegram, pick up in the terminal, continue in the browser. The agent knows who said what, on which channel, and connects context across all of them.

[Blog: Why your agent needs one session](https://kern-ai.com/blog/why-your-agent-needs-one-session)

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
