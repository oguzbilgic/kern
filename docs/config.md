# Configuration

## Per-agent: .kern/config.json

The main config file. Committed to git. Unknown fields and wrong types are warned on startup and ignored — defaults apply.

```json
{
  "model": "anthropic/claude-opus-4.6",
  "provider": "openrouter",
  "toolScope": "full"
}
```

### Fields

| Field | Default | Description |
|-------|---------|-------------|
| `model` | `anthropic/claude-opus-4.6` | Model ID. Format depends on provider. |
| `provider` | `openrouter` | API provider: `openrouter`, `anthropic`, `openai` |
| `toolScope` | `full` | Tool access level: `full`, `write`, `read` |
| `maxSteps` | `30` | Max tool-use steps per message |
| `maxContextTokens` | `50000` | Token budget for context window. Messages beyond this are trimmed oldest-first. Full history stays in [session storage](sessions.md). |
| `maxToolResultChars` | `20000` | Max characters per tool result in context. Oversized results are truncated in context only. Full results stay in session storage. Set to `0` to disable. |
| `heartbeatInterval` | `60` | Minutes between heartbeat prompts. Agent reviews notes, updates knowledge. 0 to disable. |
| `recall` | `true` | Enable recall and segments (embedding-based features). Set to `false` to disable. Requires an embedding API key. Session storage and notes summaries work regardless. |
| `historyBudget` | `0.2` | Fraction of `maxContextTokens` for compressed history from segments. Set to `0` to disable. See [Context](context.md#conversation-summary). |
| `autoRecall` | `false` | Automatically inject relevant old context before each turn. Requires recall enabled. |

### Tool scopes

- **full** — bash, read, write, edit, glob, grep, webfetch, kern, message, recall
- **write** — read, write, edit, glob, grep, webfetch, kern, message, recall
- **read** — read, glob, grep, webfetch, kern, recall

### Providers

- **openrouter** — routes to cheapest provider. Model IDs like `anthropic/claude-opus-4.6`. Uses OpenAI-compatible chat completions API.
- **anthropic** — direct Anthropic API. Model IDs like `claude-opus-4-6-20260301`.
- **openai** — OpenAI or Azure. Model IDs like `gpt-4o`.

## Per-agent: .kern/.env

Secrets. Gitignored. Never committed.

```
OPENROUTER_API_KEY=sk-or-...
TELEGRAM_BOT_TOKEN=...
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
KERN_AUTH_TOKEN=...
```

Only set the API keys for providers/interfaces you use.

### Auth tokens

**`KERN_AUTH_TOKEN`** — per-agent Bearer token required on all agent API endpoints (except `/health`).

- Auto-generated on first agent start — written to `.kern/.env` automatically
- Registered in `~/.kern/agents.json` so the TUI and web proxy can read it
- TUI reads it from the registry automatically
- Web proxy injects it into proxied requests — the browser never sees agent tokens

**`KERN_WEB_TOKEN`** — web proxy auth token stored in `~/.kern/.env`.

- Auto-generated on first `kern web start`
- Required on all `/api/*` proxy routes (Bearer header or `?token=` query param)
- Printed by `kern web start` and `kern web token`
- Web UI prompts for it on first visit, saves to localStorage

You never need to set either token manually unless you want specific values.

## Global: ~/.kern/config.json

Global settings for the `kern web` server. Optional — defaults apply if the file doesn't exist.

```json
{
  "web_port": 9000,
  "web_host": "0.0.0.0"
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `web_port` | `9000` | Port for the `kern web` UI server. |
| `web_host` | `0.0.0.0` | Bind address for the web UI server. |

## Global: ~/.kern/agents.json

Agent registry. Managed automatically — do not edit by hand.

Tracks all registered agents with their name, path, PID, port, and auth token. Updated when agents start/stop.

## .kern/ local files

See [Sessions](sessions.md) for details on session storage, the memory database, and local file layout.
