# Changelog

## next

### Features
- **WebFetch tool** — fetch URLs directly, no need for `curl` via bash
- **Tool scopes** — replace per-tool config with `toolScope: "full" | "write" | "read"`. New tools automatically available to all agents.
- **Context-aware messaging** — messages include `[via <interface>, <channel>, user: <id>]` metadata so the agent knows who's talking and where
- **Runtime context injection** — system prompt includes interface adaptation rules (brief on Telegram, detailed on CLI, professional in Slack channels)
- **KERN.md** — externalized runtime context file, editable per agent, ships with package as fallback
- **Telegram formatting** — markdown converted to Telegram HTML (bold, italic, code, blockquotes, lists)
- **Dual bin** — both `kern` and `kern-ai` commands work

### Changes
- Renamed repo and npm package to `kern-ai`
- `toolScope` replaces `tools` array in config (legacy `tools` field ignored)

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
