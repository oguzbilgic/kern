# Changelog

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
