# Changelog

## v0.11.0 (unreleased)

### Features
- **Web UI** — browser-based chat interface via `kern web start/stop/status`.
  - **Streaming** — full conversation history with live streaming responses and thinking indicator between tool steps.
  - **Agent sidebar** — avatars with online/offline status. Collapsible on desktop, slide-out on mobile.
  - **Slash commands** — `/status`, `/restart`, `/help` with autocomplete popup.
  - **Collapsible tool output** — click to expand. Edit tools show inline red/green diffs.
  - **Markdown** — headers, lists, blockquotes, tables, code blocks, inline formatting.
  - **Message filters** — toggle heartbeats, TUI, tool calls, Telegram/Slack. Hides entire turns.
  - **Timestamps** — shown on user, incoming, and outgoing messages.
  - **Agent info panel** — version, model, uptime, session stats, connection string with copy.
  - **Auto-discovery** — finds running agents, reconnects after restart.
  - **Dark theme** — mobile-friendly, PWA support.
- **Auto-generated auth tokens** — `KERN_AUTH_TOKEN` generated on first agent start, stored in `.kern/.env` and `agents.json`. All API endpoints require token (except `/health`).
- **Agents bind `0.0.0.0` by default** — accessible over Tailscale/LAN, secured by auto-generated token.
- **`/help` slash command** — lists available commands with descriptions.
- **Global config** — `~/.kern/config.json` for `web_port` and `web_host`.
- **`kern init` next steps** — shows `kern tui` and `kern web start` after agent creation.

### Changes
- Agents serve API only — no HTML from agent process. `KERN_HOST`/`KERN_PORT` env vars removed. `host` field in `.kern/config.json` (default `0.0.0.0`).
- Status data shared across tool, slash command, HTTP API, and web UI via `getStatusData()`.
- KERN.md: added web UI interface guidance, markdown note, `/help` command.
- Docs updated: README, config, interfaces, commands.

## v0.10.0

### Features
- **Slash commands** — runtime-level commands that bypass the LLM entirely.
  - `/restart` — restarts the agent daemon. 2-second delay to let Telegram acknowledge before process dies. Registered as a Telegram bot command.
  - `/status` — instant runtime status (model, uptime, session size, API usage, TUI connection). Shares implementation with the `kern` tool's status action.
- **Heartbeat TUI awareness** — heartbeat message now includes TUI connection status (`[heartbeat, tui: connected/disconnected]`). Agent knows whether the operator is watching and can use the message tool to reach them if not.
- **Session recovery** — on session load, detects incomplete turns (assistant tool-call without matching result) and injects a synthetic continuation message to prevent restart loops.
- **Interactive import** — `kern import opencode` now shows pickers for project, session, and destination agent. Supports `--project`, `--session`, `--agent` flags for automation. Always confirms selection (no silent auto-select).

### Changes
- Restart moved from kern tool to `/restart` slash command — agent cannot restart itself, must ask operator.
- Import flags use space-separated format (`--project /path`) matching standard CLI conventions.
- KERN.md updated: config changes require restart, agent told to ask operator for `/restart`.

## v0.9.1

### Changes
- **Dynamic model list** — `kern init` now fetches available models live from provider APIs (OpenRouter, Anthropic, OpenAI). Falls back to curated defaults if offline or API key not yet provided. (Community PR #1)
- **Better error messages** — captures the real provider error from the `onError` stream hook instead of showing generic "No response from model" when the API fails.

### Fixes
- **Message tool misuse** — agents were using the `message` tool to reply to incoming Telegram messages instead of responding directly. Tool description now explicitly prevents this.
- **Anthropic model IDs** — fixed direct Anthropic API model aliases (`claude-opus-4-6`, `claude-sonnet-4-6`). (Community PR #1)

## v0.9.0

### Features
- **TUI Redesign** — complete rewrite using Ink (React for CLIs).
  - Clean block-based layout with deterministic vertical spacing (no double lines).
  - Robust terminal resizing using ANSI erase-in-line (`\x1b[K`) logic.
  - Live connection status indicator (`●`/`○`) that automatically reconnects and refetches agent status when the daemon restarts.
- **TUI Markdown Support** — custom markdown parsing inside the TUI to render code blocks, blockquotes, headings, bold, italic, and inline code natively in the terminal.
- **TUI Muted Content** — system output like `NO_REPLY` is now rendered dimmed and italicized to preserve visual hierarchy.

## v0.8.0

### Features
- **`kern import opencode`** — migrate sessions from OpenCode to kern. Reads OpenCode's SQLite, converts messages/parts to AI SDK ModelMessage format, validates pairing, writes JSONL.

### Fixes
- **Trim performance** — O(n) with WeakMap cache for per-message token sizes (was O(n²), slow on large imported sessions)
- **Telegram NO_REPLY** — suppress and delete placeholder message instead of sending

## v0.7.0

### Features
- **Heartbeat** — periodic `[heartbeat]` message every N minutes (configurable `heartbeatInterval`, default 60). Agent reviews notes, updates knowledge, messages operator if needed. TUI-only visibility (`♡` marker).
- **Message queue** — all messages serialized through a queue with 5-minute timeout. Same-channel messages injected mid-turn via `prepareStep`. Cross-channel messages wait in FIFO. Heartbeats deferred.
- **Same-channel injection** — send a follow-up while the agent is working, it sees your message at the next tool step wrapped in `<system-reminder>`. No waiting for the full turn to finish.
- **Kernel auto-update** — AGENTS.md ships with kern, versioned `<!-- kernel: v1.0 -->`. Updated automatically on `kern start` if a newer version is bundled.
- **Timestamps** — all messages tagged with `time:` in metadata. Agent can reason about time ("remind me in 30 minutes").
- **`kern logs`** — tail agent logs with `kern logs [name]`. Auto-selects agent.
- **Structured logging** — colored, timestamped logs across all components: kern, queue, runtime, telegram, slack, server. Startup/shutdown bookends.

### Changes
- Templates (AGENTS.md, KERN.md) moved to `templates/` in the package
- Startup header replaced with structured log lines
- All interfaces (Telegram, Slack, TUI, HTTP, heartbeat) route through message queue
- Telegram event flow restored via queue onEvent callback — tool calls show during processing
- Telegram multi-block: text → tools → text produces separate messages
- Tool display shows action for kern tool, userId for message tool
- Slack suppresses `(no text response)` alongside NO_REPLY
- Kern agents noted as loop-aware in KERN.md

## v0.6.3

### Fixes
- **Streaming actually works now** — `text-delta` events use `delta` field in AI SDK v6, not `text`. Was reading undefined since v0.1.0. Text now streams word-by-word instead of appearing all at once.

## v0.6.2

### Features
- **Auto-pair first user** — first person to message the bot becomes the operator. No code needed, silent pairing. Every user after goes through the code flow.
- **`kern pair` CLI command** — approve pairing codes from the command line: `kern pair <agent> <code>`. No agent interaction needed.

## v0.6.1

### Features
- **Non-interactive init** — `kern init <name> --api-key <key>` for automation. Defaults to openrouter + opus 4.6. Optional flags: `--provider`, `--model`, `--telegram-token`, `--slack-bot-token`, `--slack-app-token`.

## v0.6.0

### Features
- **Backup & restore** — `kern backup <name>` creates `.tar.gz` in `~/.kern/backups/`. `kern restore <file>` extracts, registers, warns on overwrite. Full agent portability — move agents between machines with memory intact.

## v0.5.0

### Features
- **Slack integration** — Bolt SDK + Socket Mode. DMs with pairing. Channels: agent reads all messages, only responds when @mentioned or relevant (NO_REPLY suppression). Replies post to channel directly. Markdown converted to Slack mrkdwn. Rich text blocks parsed for full message content.
- **Agent-to-agent awareness** — KERN.md teaches agents not to loop with other agents. NO_REPLY to break infinite volleys, let humans drive.
- **Documentation** — `docs/` with config, tools, interfaces, pairing, commands reference. Linked from KERN.md for agent self-reference.

### Fixes
- SSE keepalive pings every 15s — prevents TUI body timeout crash on long-lived connections

## v0.4.0

### Features
- **User pairing** — code-based user approval for Telegram. Unpaired users get a `KERN-XXXX` code, operator approves via agent with context, agent writes USERS.md.
- **`kern({ action: "pair" })`** — approve a pairing code from within the agent
- **`kern({ action: "users" })`** — list paired and pending users
- **USERS.md** — per-agent user directory with identity, role, guardrails. Created by `kern init`.
- **No more allowlist** — pairing replaces `telegram.allowedUsers` config. Everyone pairs, including the operator.
- **Message tool** — agent can proactively send messages to paired users on any channel. `message({ userId, interface, text })`.
- **Outgoing messages in TUI** — green `→` marker shows when agent sends a message to a channel.

### Changes
- Telegram adapter uses PairingManager instead of allowedUsers array
- PairedUser stores chatId for outgoing messages
- 10 built-in tools (was 8): added message, updated kern with pair/users actions
- KERN.md documents full pairing flow and operator identity
- TUI recognized as operator in system prompt — no pairing needed, full trust
- TUI layout flush left for all markers (◇ ◆ → and tool calls)

## v0.3.0

### Features
- **Daemon mode** — `kern start` / `kern stop` / `kern restart` to run agents in background with PID tracking
- **HTTP server per agent** — each agent runs an HTTP server on a random local port for TUI and future web UI
- **SSE event stream** — all events (text, tool calls, cross-channel messages) broadcast via Server-Sent Events
- **`kern tui`** — connects to running daemon via HTTP/SSE, auto-starts if needed, auto-selects if one agent
- **Cross-channel TUI** — see Telegram messages in real time from the TUI (yellow ◇ marker)
- **Agent registry** — `~/.kern/agents.json` auto-populated by init, start, and run commands
- **`kern list`** — show all registered agents with running state (green/red/dim dots), port numbers
- **`kern init` config mode** — re-run on existing agent to reconfigure (arrow-key select, masked passwords), auto-restart
- **Inquirer prompts** — arrow-key provider and model selection in init wizard
- **Startup verification** — `kern start` waits 2s, shows error log if agent crashes
- **Context window trimming** — sliding window over message history, configurable `maxContextTokens`
- **Persistent API usage** — token counts saved to `.kern/usage.json`, survives restarts
- **Status shows session vs context** — full session size and trimmed context window separately
- **Uniform channel metadata** — all messages (TUI, Telegram, Slack) tagged with `[via interface, channel, user]`
- **OpenRouter app headers** — requests show "kern-ai" in OpenRouter logs
- **Model list** — updated from OpenRouter leaderboard (Opus 4.6, Sonnet 4.6, MiMo, DeepSeek V3.2, GPT-5.4, Gemini 3.1 Pro, etc.)
- **`kern init` adopts existing repos** — adds `.kern/` without overwriting AGENTS.md, IDENTITY.md, etc.
- **`kern remove`** — unregister an agent (stops if running, doesn't delete files)
- **Help screen** — colorized command reference with `kern` or `kern help`

### Changes
- `kern` (no args) shows help instead of running in cwd
- `kern tui` always CLI, `kern start` runs Telegram/Slack in background
- `kern status` renamed to `kern list` (`status` still works as alias)
- All channels get metadata prefix — no special cases for TUI
- Default `maxContextTokens`: 40000 (estimated, ~160k real tokens)

### Fixes
- `kern restart` works (process.exit removed from daemon internals)
- TUI doesn't echo own messages from SSE broadcast
- TUI spinner only when sending, no CLEAR_LINE wiping cross-channel content
- Token estimate uses full JSON.stringify (was undercounting with text-only)
- `kern init` detects agents by registry name, not just path

## v0.2.0

### Features
- **WebFetch tool** — fetch URLs directly, no need for `curl` via bash
- **Kern self-management tool** — agent can check its own status, view config, inspect env vars via `kern({ action: "status" | "config" | "env" })`
- **Token tracking** — prompt and completion tokens tracked per session, shown in kern status
- **Tool scopes** — replace per-tool config with `toolScope: "full" | "write" | "read"`. New tools automatically available to all agents.
- **Context-aware messaging** — messages include `[via <interface>, <channel>, user: <id>]` metadata so the agent knows who's talking and where
- **Runtime context** — system prompt includes interface adaptation rules (brief on Telegram, detailed on CLI, professional in Slack channels)
- **Tool list injection** — available tools and descriptions injected into system prompt dynamically
- **KERN.md** — externalized runtime context file, editable per agent, ships with package as fallback
- **Telegram formatting** — markdown converted to Telegram HTML (bold, italic, code, blockquotes, lists) with plain text fallback
- **Telegram typing indicator** — stays active throughout long responses, refreshes every 4 seconds
- **Telegram tool visibility** — tool calls shown live (⚙ read, ⚙ bash...) then replaced by response
- **Version display** — shown in CLI header and kern tool status
- **Dual bin** — both `kern` and `kern-ai` commands work

### Fixes
- Descriptive error messages — rate limit, credits exhausted, auth failure, DNS errors shown clearly instead of generic "No output generated"
- Safe token usage tracking — won't crash if usage data unavailable

### Changes
- Renamed repo and npm package to `kern-ai`
- `toolScope` replaces `tools` array in config (legacy `tools` field ignored)
- 8 built-in tools (was 6): added webfetch, kern

## v0.1.0

First release.

### Features
- **CLI agent** with streaming TUI — live text, spinner, color-coded tool calls, blue diamond response marker
- **6 built-in tools** — bash, read, write, edit, glob, grep
- **Session persistence** — conversations saved as JSONL, resume across restarts
- **3 providers** — OpenRouter, Anthropic, OpenAI
- **Telegram adapter** — long polling, works behind NAT, user allowlist
- **`kern init` wizard** — scaffolds agent-kernel repo with config, secrets, git
- **CLI interface** — conversation history on startup, streaming responses
- **Agent kernel pattern** — AGENTS.md + IDENTITY.md as system prompt
