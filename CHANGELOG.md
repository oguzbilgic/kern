# Changelog

## next

### Features
- **Memory overlay** ([#32](https://github.com/oguzbilgic/kern-ai/pull/32)) — web UI for inspecting agent memory: notes summaries with regeneration, recall search, session list with daily/hourly activity charts.
- **Context overlay** ([#32](https://github.com/oguzbilgic/kern-ai/pull/32)) — structured view of the full system prompt. Parses XML tags into collapsible sections with token cost bars. Shows real token breakdown (system + summary + messages) from `/status`.

### Changes
- **Token estimation** ([#32](https://github.com/oguzbilgic/kern-ai/pull/32)) — improved from chars/4 to chars/3.3 with per-message overhead (~25% more accurate).
- **Context breakdown** ([#32](https://github.com/oguzbilgic/kern-ai/pull/32)) — `/status` reports system prompt + summary + messages token counts across all consumers (HTTP, slash cmd, kern tool, web UI).
- **Rename `historyBudget` → `summaryBudget`** ([#32](https://github.com/oguzbilgic/kern-ai/pull/32)) — renamed throughout codebase and docs.
- **Docs reorganized** ([#32](https://github.com/oguzbilgic/kern-ai/pull/32)) — split `memory.md` into `memory.md` and `context.md`.

## v0.17.0

### Features
- **Android app** ([#15](https://github.com/oguzbilgic/kern-ai/pull/15)) — native mobile app for chatting with kern from Android devices.
  - Connects to any `kern web` server (local, LAN, Tailscale, or tunnel)
  - Improves mobile streaming reliability
  - Adds voice input and text-to-speech
- **Segment summary improvements** ([#29](https://github.com/oguzbilgic/kern-ai/pull/29)) — summaries preserve request → action → outcome causality while keeping the concrete details that make an event recognizable later.
  - Summaries are grounded with `IDENTITY.md` and `USERS.md` so operator, channel, and participant distinctions survive compression better
  - Added single-segment `Resummarize` to regenerate one summary in place
  - `composeHistory()` now returns the exact selected segment metadata, not just rendered text
- **Service management** ([#28](https://github.com/oguzbilgic/kern-ai/pull/28)) — `kern install` sets up user-level systemd services for agents and the web daemon. Crash recovery, boot persistence, one command.
  - `kern install` — all agents + web. `kern install <name>` or `kern install --web` for individual.
  - `kern uninstall [name]` — remove services.
  - `kern start/stop/restart` automatically delegate to systemd when installed, fall back to PID daemon otherwise.
  - `kern remove` cleans up the systemd service before unregistering.
  - Hints shown after `kern init`, `kern start`, and in `kern status` when systemd is available but not installed.
- **Context inspection** ([#29](https://github.com/oguzbilgic/kern-ai/pull/29)) — new APIs and web UI make prompt composition inspectable.
  - `/prompt/system` replaced by `GET /context/system`
  - Added `GET /context/segments` for the exact segments currently injected into prompt history
  - System prompt overlay supports `Markdown` / `Raw` views
  - Segment detail panel renders markdown summaries, has cleaner metadata layout, and preserves expanded/selected state during live refresh
  - Segment overlay shows `All` / `Context` filters, clearer modal styling, and confirmation prompts for `Clean` / `Rebuild`
- **Cross-platform shell** ([#25](https://github.com/oguzbilgic/kern-ai/pull/25)) — `bash` tool on Unix, `pwsh` tool on Windows. One shell tool per platform, selected automatically. No config needed.
  - `grep` works on Unix only; on Windows suggests `Select-String` via pwsh

### Changes
- **Logging** ([#24](https://github.com/oguzbilgic/kern-ai/pull/24)) — structured, leveled, colored log output. All levels written to file, filtering only at read time.
  - `kern logs` — follow mode by default. `-n 50` for last N lines. `--level warn` to filter.
  - `kern({ action: "logs" })` — agent can inspect its own logs (default warn+).
- **Status overhaul** ([#28](https://github.com/oguzbilgic/kern-ai/pull/28)) — `kern status` now shows the web daemon alongside agents. New `mode` field (systemd/daemon/—) shows how each process is managed.
- **Config validation** ([#23](https://github.com/oguzbilgic/kern-ai/pull/23)) — warns on unknown fields and wrong types at startup. Invalid values ignored, defaults apply.
- **Config cleanup** ([#23](https://github.com/oguzbilgic/kern-ai/pull/23)) — `kern init` now writes minimal config and stale legacy fields are ignored.
  - `kern init` writes `model`, `provider`, and `toolScope` only
  - Removed stale `telegram.allowedUsers` and `telegram.showTools` config fields
  - Dropped legacy `tools` array support (use `toolScope` instead)

## v0.16.0

### Features
- **Semantic segments** — messages are automatically grouped into topic-coherent segments (L0) based on embedding cosine distance. Each segment is summarized by gpt-4.1-mini (~10-20:1 compression). First-person, bullet-point style focusing on intent, outcomes, and decisions.
- **Hierarchical rollups** — every 10 L0 segments are summarized into an L1 parent. 10 L1s → L2, etc. Builds a multi-level summary tree.
- **Compressed history injection** — when old messages are trimmed from context, `composeHistory()` fills a token budget (`historyBudget`, default 20% of context) with segment summaries. High-level summaries cover old history cheaply, recent segments expand to detailed lower levels. Injected as `<conversation_summary>` in the system prompt.
- **Structured system prompt** — all system prompt sections wrapped in XML tags for clear identification:
  - `<document path="...">` for loaded markdown files
  - `<notes_summary>` for daily notes summary
  - `<tools>` for tool list
  - `<conversation_summary>` with nested `<summary>` blocks for compressed history
  - No more `---` delimiters between sections.
- **System prompt endpoint** — `GET /prompt/system` returns the full composed system prompt for inspection.
- **Status enrichment** — `/status` now reports history tokens injected, segment level counts, and total segments per level.

### Web UI
- **Segments visualization** — proportional colored blocks representing token density and message spans. Hover detail panel with full summary text, message range, timestamps, token counts.
- **Level toggle** — switch between L0, L1, L2 views with collapsible rolled-up child segments.
- **Segment controls** — Start, Stop, Rebuild, Clean buttons for managing segmentation lifecycle.
- **System prompt overlay** — button opens full composed system prompt in a scrollable panel.

### Config
- `historyBudget` (default `0.2`) — fraction of `maxContextTokens` allocated to compressed history. Set to `0` to disable.

### Changes
- `prepareContext()` now accepts `sessionId` and `segmentIndex` for history injection. Returns `systemAdditions` array and `trimmedCount`.
- `trimToTokenBudget()` returns trimmed message count for history injection.
- `loadNotesContext()` returns `latestFile` for document path tagging.
- `Runtime` gains `buildPromptContext()` and `getSystemPrompt()` public methods.

### Docs
- Updated `memory.md` — segments and conversation summary section with XML examples, tag reference table.
- Updated `config.md` — `historyBudget` field, new DB tables in schema section.
- Updated `KERN.md` template — references `<conversation_summary>` instead of `<history>`.

---

## v0.15.0

### Features
- **Notes injection** — agent system prompt now includes latest daily note (full content) and an LLM-generated summary of the previous 5 daily notes. Agents boot with recent context automatically.
  - Summary cached in SQLite `summaries` table. Non-blocking regeneration on day rollover.
  - System prompt reloaded per message — picks up new notes/knowledge/summaries without restart.
- **MemoryDB** (`memory.ts`) — new module owns SQLite database, schema, and summaries table. Always created on startup (works even with `recall: false`).
  - RecallIndex now takes MemoryDB instead of managing its own connection.
- **Tool result truncation** — `maxToolResultChars` config (default 20,000) caps oversized tool results in context only. Full results preserved in session JSONL and recall.
- **Context pipeline** (`context.ts`) — extracted from runtime.ts. Owns truncate → trim → stats. Single `prepareContext()` entry point.

### Web UI
- **Syntax highlighting** — highlight.js via CDN for tool output rendering.
  - **Read**: line number gutter + language-detected highlighting (TS, JS, Python, Go, Rust, SQL, YAML, Bash, etc.)
  - **Edit**: syntax-highlighted unified diff. Old lines dimmed (40% opacity), new lines full brightness. `−`/`+` gutter markers.
  - **Write**: syntax-highlighted content based on file extension.
  - **Grep**: ANSI color passthrough — file paths magenta, line numbers green, matches bold red.
- **Fullscreen expand** — `⛶` button on tool header line. Only visible when expanded and content overflows. Dark overlay, Escape/click-outside to dismiss.
- ANSI color support in all tool output (`ansiToHtml` renderer).
- Consistent spacing for tool results (`tool-result-text` div replaces `\n\n` whitespace).
- Fix SSE duplicate stream bug by tracking active EventSource.
- Debounced streaming render + textarea auto-resize to reduce input lag on mobile.
- Disable autocorrect/spellcheck on input textarea.
- Prevent duplicate agents when local URL added as remote server.

### Tools
- **grep** — new `options` param for raw grep flags (`-C 3 -i -l`, etc.). Auto-excludes `node_modules`, `.git`, `dist`. `--color=always` for colored output. Single-file mode drops `-r` for clean line-only output.

### Changes
- Default `maxContextTokens` increased from 40k to 50k.
- OpenRouter: added `X-OpenRouter-Categories` header for attribution.

### Docs
- New `memory.md` page covering all memory layers, auto-injection, and persistence.
- Updated `config.md` with `maxToolResultChars` and `maxContextTokens` defaults.
- Updated `KERN.md` template with auto-injected context details.

---

## v0.14.2

### Fixes
- Strip leading newlines from assistant messages (stream + persisted).

### Web UI
- Sidebar footer: version left, links right.

---

## v0.14.1

### Fixes
- Errors (credit limits, auth failures) now surface to the user instead of silent empty responses.
- Focus input on agent switch.

### Web UI
- Sidebar footer with Docs, GitHub, and version.
- Logo links to kern-ai.com.
- Cleaner tool styling — borderless, rounded corners. Bash shows `$ command`.
- User messages — no border, fully rounded.
- Darker, consistent tool background.
- Removed "connected" system message.

### Docs
- Added Get Started guide.
- Docs included in npm package.

---

## v0.14.0

### Features
- **Web proxy** — `kern web` now proxies all agent API requests. Browser never talks to agents directly.
  - Routes: `/api/agents/:name/status`, `/api/agents/:name/message`, `/api/agents/:name/events`, `/api/agents/:name/history`, `/api/agents/:name/health`.
  - Agent HTTP servers bind to `127.0.0.1` — only reachable locally via proxy.
  - Proxy injects agent auth tokens automatically — web UI never sees them.
- **Web auth** — `KERN_WEB_TOKEN` auto-generated on first `kern web start`, stored in `~/.kern/.env`.
  - All `/api/*` routes require Bearer token or `?token=` query param.
  - Static HTML/PWA files remain public.
  - Web UI prompts with a modal on first visit. Token saved to localStorage.
  - Logout button in sidebar header clears token and returns to auth prompt.
- **`kern web token`** — print the web UI URL with auth token anytime.
- **`kern web start` prints token** — always shows the URL with token on start and when already running.
- **Multi-server discovery** — web UI sidebar groups agents by server.
  - Local agents shown first, remote servers shown with hostname header.
  - "Add server" modal with URL + token fields.
  - Remove button on remote server headers.
  - Servers stored as `{url, token}` objects in localStorage.
- **Auto-expand last tool call** — latest tool call stays expanded during streaming. Collapses when the next tool starts or text response begins.
- **Smart scroll** — won't pull you down when scrolled up reading history. Auto-scrolls only when at the bottom.
- **Scroll-to-bottom button** — floating ↓ button appears when scrolled up, click to jump back down.
- **SSE cleanup** — proxy aborts agent connection when browser disconnects.

### Changes
- Agents bind `127.0.0.1` instead of `0.0.0.0` — no longer directly accessible over the network.
- Web UI no longer stores or manages per-agent tokens. Auth is at the proxy level.
- Agent discovery returns name and running state only — no port or token exposed.
- Removed `host` config field — agents always bind localhost now.

## v0.13.0

### Features
- **Recall tool** — semantic search over past conversations outside the current context window. Agents can now remember things from weeks ago.
  - **Search mode** — query by meaning, get ranked results with distance scores. Optional `before`/`after` date filters.
  - **Load mode** — fetch raw messages by session ID and index range for full context around a search hit.
  - **Messages in sqlite** — raw messages stored in recall.db alongside embedded chunks. Load mode reads from sqlite, no JSONL parsing on retrieval.
  - **Non-blocking backfill** — index builds in background on startup. Agent is available immediately. Status shows `(building)` until complete.
  - **Incremental indexing** — only new JSONL lines are parsed after each turn. No full-file re-reads.
  - **sqlite-vec** — local vector database using sqlite-vec extension. No external services needed.
  - **Turn-based chunking** — messages chunked by user→assistant turns, embedded via `text-embedding-3-small` (1536 dimensions).
  - **Recall in status** — `kern({ action: "status" })` and web UI show message/chunk counts and build state.
  - **Opt-out** — set `"recall": false` in config to disable.
  - 11 built-in tools (was 10).
- **Auto-recall** — before each turn, relevant old context is automatically injected into the sliding window.
  - Embeds user message, searches recall index (top 3, distance < 0.95).
  - Skips chunks already visible in context window (dedup by message index).
  - Injects `<recall>` block at top of context (ephemeral, not persisted to session).
  - Capped at ~2000 tokens.
  - Web UI shows collapsible `📎 N memories recalled` with query and chunk details.
  - **Opt-in** — set `"autoRecall": true` in config to enable.
- **KNOWLEDGE.md in system prompt** — memory index file is now loaded into the system prompt automatically, so agents know what state files exist without being told.

## v0.12.0

### Features
- **Incremental session persistence** — session is saved after each step via `onStepFinish`, not just at end of turn. Crash mid-turn no longer loses the entire turn's work. History is available on page refresh mid-turn.
- **Mid-turn thinking indicator** — web UI checks `/status` on load and shows thinking dots if the agent is mid-turn. Dots also show during tool execution.
- **Mid-turn messaging** — send messages while the agent is working. Input stays enabled in both Web UI and TUI. Messages are injected between tool steps via `prepareStep` and the agent addresses them inline.
- **Interface status** — `/status` API and slash command now report `telegram` and `slack` connection state (connected/disconnected/error). Web UI info panel shows them.
- **Queue status in `/status`** — shows busy/idle and pending message count.
- **Slash commands bypass queue** — `/status`, `/restart`, `/help` respond instantly even when the queue is busy.
- **Tool output in web UI** — `write` shows file content, `message` shows message text in collapsible tool output.

### Fixes
- **Telegram crash on restart** — SIGTERM handler now stops Telegram bot polling before exit. Previously, the old `getUpdates` long-poll lingered for up to 30s, causing the new process to hit a 409 Conflict and crash with an unhandled grammyError. Added `bot.catch()` and 409 retry logic.
- **Graceful shutdown** — SIGTERM/SIGINT stop Telegram and Slack interfaces before `process.exit()`.
- **Cross-client message sync** — SSE clients get unique connection IDs; broadcasts exclude the sender to prevent echo. New `user-remote` message type for messages from other web/TUI tabs.
- **History tool output** — appends to pre-filled content instead of overwriting.
- **Session-scoped active agent** — uses `sessionStorage` so each browser tab tracks its own agent independently.

### Changes
- Web UI info panel closes on agent switch to prevent stale data.
- TUI cursor stays visible during agent processing.
- README updated with npm install instructions and browser references.

## v0.11.0

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
