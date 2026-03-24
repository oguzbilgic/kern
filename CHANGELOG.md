# Changelog

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
