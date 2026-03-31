# Configuration

## Per-agent: .kern/config.json

The main config file. Committed to git.

```json
{
  "model": "anthropic/claude-opus-4.6",
  "provider": "openrouter",
  "toolScope": "full",
  "maxSteps": 30,
  "maxContextTokens": 40000,
  "host": "0.0.0.0"
}
```

### Fields

| Field | Default | Description |
|-------|---------|-------------|
| `model` | `anthropic/claude-opus-4.6` | Model ID. Format depends on provider. |
| `provider` | `openrouter` | API provider: `openrouter`, `anthropic`, `openai` |
| `toolScope` | `full` | Tool access level: `full`, `write`, `read` |
| `maxSteps` | `30` | Max tool-use steps per message |
| `maxContextTokens` | `40000` | Estimated token budget for context window. Messages beyond this are trimmed from the front (oldest first). Full history stays in JSONL. |
| `heartbeatInterval` | `60` | Minutes between heartbeat prompts. Agent reviews notes, updates knowledge. 0 to disable. |
| `host` | `0.0.0.0` | Bind address for the agent's HTTP API. Default binds to all interfaces. Set to `127.0.0.1` for localhost only. |
| `recall` | `true` | Enable recall (long-term memory). Set to `false` to disable. Requires an embedding API key. |

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

### Auth token

`KERN_AUTH_TOKEN` is a Bearer token required on all agent API endpoints (except `/health`).

- **Auto-generated** on first agent start if not set — written to `.kern/.env` automatically
- **Registered** in `~/.kern/agents.json` so the TUI and web UI can read it
- TUI reads it from the registry automatically
- Web UI gets it via agent discovery (`/api/agents` endpoint on `kern web`)

You never need to set this manually unless you want a specific token value.

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

## .kern/recall.db

SQLite database with sqlite-vec extension for the recall tool. Contains three tables: `messages` (raw message content), `chunks` (turn-level summaries), and `vec_chunks` (embeddings). Auto-created on first start. Gitignored. Safe to delete — will be rebuilt on next start from session JSONL files.

## .kern/sessions/

Conversation history as JSONL files. One file per session. First line is metadata, rest are messages. Gitignored.

## .kern/pairing.json

Pending and paired user data. Transient — codes expire on restart. Paired users persist.

## .kern/usage.json

Cumulative API token usage. Persists across restarts.

## .kern/logs/

Log files from daemon mode (`kern start`). `kern.log` contains stdout/stderr.
