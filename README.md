# kern

One agent. One folder. One continuous conversation.

kern gives an AI agent a single mind — one continuous session shared across CLI, Telegram, and Slack. Identity, memory, and conversation live in a plain folder. No server, no database. Just `npx kern-ai`.

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

## How it works

```
TUI ──────────────┐
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
kern list                 # show all agents
kern remove <name>        # unregister an agent
```

Agents auto-register when you init, start, or run them. `kern list` shows every agent with its running state.

## User pairing

Users pair with a code before they can chat:

1. Unknown user messages the bot → gets a `KERN-XXXX` code
2. User shares code with the operator
3. Operator tells the agent: "pair KERN-7X4M — that's Sarah, cofounder"
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

## Configuration

`.kern/config.json`:

```json
{
  "model": "anthropic/claude-opus-4.6",
  "provider": "openrouter",
  "toolScope": "full",
  "maxSteps": 30
}
```

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
