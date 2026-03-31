# kern

AI agents built for coworking.

One brain across every channel. Your agent sits in Slack channels, Telegram DMs, the terminal, and the browser. It knows who's talking, reads the room, and remembers everything. Humans and agents, same channels, same conversation.

## Why kern

Most agent frameworks give you sessions that reset, memory that's a black box, or infrastructure you have to manage. kern takes a different approach:

- **One brain** — a single continuous session across every interface. Message from Telegram, pick up in the terminal, continue in the browser. The agent always knows what happened.
- **Context-aware** — the agent knows who's talking and where. It sees the user, the channel, and the interface — so it can adjust tone, filter context, and keep track of different conversations within the same session.
- **A folder is the agent** — AGENTS.md defines behavior, IDENTITY.md defines who it is, knowledge/ and notes/ are its memory. Everything is plain text, git-tracked, and inspectable.
- **No infra** — no server, no database, no vector store. A folder, an API key, and `npm install -g kern-ai`.

kern pairs with [agent-kernel](https://github.com/oguzbilgic/agent-kernel) — the kernel defines how an agent remembers, kern runs it.

## Quick start

```bash
npm install -g kern-ai
kern init my-agent
kern tui
```

The init wizard scaffolds your agent, asks for a provider and API key, then starts it. `kern tui` opens an interactive chat. `kern web start` opens it in the browser.

For automation: `kern init my-agent --api-key sk-or-...` (no prompts, defaults to openrouter + opus 4.6).

## How it works

```
TUI ──────────────┐
Web UI ───────────┤
Hub (agents) ─────┤── kern ── one session ── one folder
Telegram DM ──────┤
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
  USERS.md               # paired users with roles and guardrails
  knowledge/             # mutable state files
  notes/                 # daily logs (append-only)
  .kern/
    config.json          # model, provider, toolScope (committed)
    .env                 # API keys, bot tokens (gitignored)
    sessions/            # conversation history (gitignored)
```

Everything the agent needs is in this folder. Move it, zip it, clone it — the agent comes with it. Run `kern init` on any existing repo to adopt it as a kern agent.

## CLI

```bash
kern init <name>          # create or configure an agent
kern start [name|path]    # start agents in background
kern stop [name]          # stop agents
kern restart [name]       # restart agents
kern tui [name]           # interactive chat
kern web <start|stop|status|token>  # web UI server
kern hub <start|stop|status>  # agent-to-agent hub
kern logs [name]          # tail agent logs
kern list                 # show all agents
kern remove <name>        # unregister an agent
kern backup <name>        # backup agent to .tar.gz
kern restore <file>       # restore agent from backup
kern import opencode         # import session from OpenCode
```

Agents auto-register when you init, start, or run them. `kern list` shows every agent with its running state.

### Web UI

`kern web start` launches a web UI server (default port 9000). It prints a URL with an auth token — click it to connect.

```bash
kern web start    # start web UI, prints URL with token
kern web stop     # stop it
kern web status   # check if running
kern web token    # print the URL with token again
```

The web UI proxies all agent requests — agents bind to localhost only and are never exposed directly. Auth is handled at the proxy level with a single `KERN_WEB_TOKEN` (auto-generated, stored in `~/.kern/.env`).

Works over Tailscale or LAN. Add remote kern servers in the sidebar.

### Hub

`kern hub start` runs a WebSocket relay for agent-to-agent communication. Agents connect, authenticate with Ed25519 keys, and message each other.

```bash
kern hub start    # start hub server (default port 4000)
kern hub stop     # stop it
kern hub status   # check if running
```

Agents connect by setting `"hub": "local"` in their `.kern/config.json`. Other options: `"default"` (kern.ai public hub) or a custom hostname.

Agents pair using KERN-XXXX codes — same pairing system as Telegram/Slack. First contact generates a code, operator tells the agent to pair, agent updates USERS.md.

### Slash commands

Type these in any channel (TUI, Web, Telegram, Slack, Hub). Handled by the runtime — no LLM call, instant response.

```
/status     # agent status, model, uptime, session size
/restart    # restart the agent daemon
/help       # list available commands
```

## User pairing

The first person to message the bot becomes the operator — auto-paired, no code needed. Every user after pairs with a code:

1. Unknown user messages the bot → gets a `KERN-XXXX` code
2. User shares code with the operator
3. Operator approves: tell the agent, or `kern pair atlas KERN-XXXX` from CLI
4. Agent pairs them and writes USERS.md with identity and access notes

No allowlists. The agent manages its own access.

## Telegram

Set `TELEGRAM_BOT_TOKEN` in `.kern/.env` and kern connects via long polling. No public URL needed — works behind NAT. Messages show up in real time in the TUI.

## Slack

Set `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN` in `.kern/.env`. Uses Socket Mode — no public URL needed.

- **DMs**: pairing required, same as Telegram
- **Channels**: agent reads all messages, only responds when @mentioned or relevant
- **NO_REPLY**: agent silently absorbs channel context without cluttering the conversation

Invite the bot to channels where it should listen.

## Heartbeat

Kern sends a periodic `[heartbeat]` to the agent. The agent reviews notes, updates knowledge files, and messages the operator if something needs attention. Visible in the TUI and web UI only — Telegram, Slack, and hub never see it.

```json
{
  "heartbeatInterval": 60
}
```

Interval in minutes. Default 60 (1 hour). Set to 0 to disable.

## Logging

```bash
kern logs [name]        # tail agent logs
```

Structured, colored logs for queue, runtime, interfaces, and server. Logs stored in `.kern/logs/kern.log`.

## Configuration

### Per-agent: `.kern/config.json`

```json
{
  "model": "anthropic/claude-opus-4.6",
  "provider": "openrouter",
  "toolScope": "full",
  "maxSteps": 30,
  "host": "0.0.0.0",
  "hub": "local"
}
```

`host` controls the agent's HTTP bind address. Default `0.0.0.0` (all interfaces). `hub` connects to a hub: `"default"` (kern.ai), `"local"` (localhost:4000), or a custom hostname.

Auth tokens are auto-generated on first start and stored in `.kern/.env`. Ed25519 keypairs generated for hub authentication. The web proxy injects agent tokens automatically — no manual setup needed.

### Global: `~/.kern/config.json`

```json
{
  "web_port": 9000,
  "web_host": "0.0.0.0",
  "hub_port": 4000
}
```

Controls `kern web` and `kern hub` servers. Optional — defaults apply if the file doesn't exist.

### Tool scopes

- **full** — bash, read, write, edit, glob, grep, webfetch, kern, message
- **write** — read, write, edit, glob, grep, webfetch, kern, message
- **read** — read, glob, grep, webfetch, kern

### Providers

- **openrouter** — any model via OpenRouter (default)
- **anthropic** — direct Anthropic API
- **openai** — OpenAI / Azure

## Documentation

Detailed docs: [docs/](https://github.com/oguzbilgic/kern-ai/tree/master/docs)

## Built with

- [Vercel AI SDK](https://sdk.vercel.ai) — model-agnostic AI layer
- [grammY](https://grammy.dev) — Telegram bot framework
- [@slack/bolt](https://slack.dev/bolt-js) — Slack bot framework
- [agent-kernel](https://github.com/oguzbilgic/agent-kernel) — the memory pattern

## License

MIT
