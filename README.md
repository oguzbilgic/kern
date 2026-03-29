# kern

AI agents built for coworking.

One brain across every channel. Your agent sits in Slack channels, Telegram DMs, and the terminal. It knows who's talking, reads the room, and remembers everything. Humans and agents, same channels, same conversation.

## Why kern

Most agent frameworks give you sessions that reset, memory that's a black box, or infrastructure you have to manage. kern takes a different approach:

- **One brain** — a single continuous session across every interface. Message from Telegram, pick up in the TUI, continue in Slack. The agent always knows what happened.
- **Context-aware** — the agent knows who's talking and where. It sees the user, the channel, and the interface — so it can adjust tone, filter context, and keep track of different conversations within the same session.
- **A folder is the agent** — AGENTS.md defines behavior, IDENTITY.md defines who it is, knowledge/ and notes/ are its memory. Everything is plain text, git-tracked, and inspectable.
- **No infra** — no server, no database, no vector store. A folder, an API key, and `npx kern-ai`.

kern pairs with [agent-kernel](https://github.com/oguzbilgic/agent-kernel) — the kernel defines how an agent remembers, kern runs it.

## Quick start

```bash
npx kern-ai init my-agent
npx kern-ai tui
```

The init wizard scaffolds your agent, asks for a provider and API key, then starts it. `kern tui` opens an interactive chat.

For automation: `npx kern-ai init my-agent --api-key sk-or-...` (no prompts, defaults to openrouter + opus 4.6).

## How it works

```
TUI ──────────────┐
Web UI ───────────┤
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
kern web <start|stop|status>  # web UI server
kern logs [name]          # tail agent logs
kern list                 # show all agents
kern remove <name>        # unregister an agent
kern backup <name>        # backup agent to .tar.gz
kern restore <file>       # restore agent from backup
kern import opencode <name>  # import session from OpenCode
```

Agents auto-register when you init, start, or run them. `kern list` shows every agent with its running state.

### Web UI

`kern web start` launches a web UI server (default port 9000). Open it in a browser to chat with any running agent.

```bash
kern web start    # start web UI server
kern web stop     # stop it
kern web status   # check if running
```

The web UI auto-discovers running agents and connects directly to their APIs. Each agent binds to `0.0.0.0` by default and auto-generates an auth token on first start — no manual config needed.

Works over Tailscale or LAN. Add remote agents manually in the sidebar.

### Slash commands

Type these in any channel (TUI, Web, Telegram, Slack). Handled by the runtime — no LLM call, instant response.

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

Kern sends a periodic `[heartbeat]` to the agent. The agent reviews notes, updates knowledge files, and messages the operator if something needs attention. Visible in the TUI only — Telegram and Slack never see it.

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
  "host": "0.0.0.0"
}
```

`host` controls the agent's HTTP bind address. Default `0.0.0.0` (all interfaces). Set to `127.0.0.1` for localhost only.

Auth tokens are auto-generated on first start and stored in `.kern/.env`. No manual setup needed.

### Global: `~/.kern/config.json`

```json
{
  "web_port": 9000,
  "web_host": "0.0.0.0"
}
```

Controls the `kern web` server. Optional — defaults apply if the file doesn't exist.

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
