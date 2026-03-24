# Configuration

## .kern/config.json

The main config file. Committed to git.

```json
{
  "model": "anthropic/claude-opus-4.6",
  "provider": "openrouter",
  "toolScope": "full",
  "maxSteps": 30,
  "maxContextTokens": 40000
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

### Tool scopes

- **full** — bash, read, write, edit, glob, grep, webfetch, kern, message
- **write** — read, write, edit, glob, grep, webfetch, kern, message
- **read** — read, glob, grep, webfetch, kern

### Providers

- **openrouter** — routes to cheapest provider. Model IDs like `anthropic/claude-opus-4.6`. Uses OpenAI-compatible chat completions API.
- **anthropic** — direct Anthropic API. Model IDs like `claude-opus-4-6-20260301`.
- **openai** — OpenAI or Azure. Model IDs like `gpt-4o`.

## .kern/.env

Secrets. Gitignored. Never committed.

```
OPENROUTER_API_KEY=sk-or-...
TELEGRAM_BOT_TOKEN=...
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
```

Only set the keys for providers/interfaces you use.

## .kern/sessions/

Conversation history as JSONL files. One file per session. First line is metadata, rest are messages. Gitignored.

## .kern/pairing.json

Pending and paired user data. Transient — codes expire on restart. Paired users persist.

## .kern/usage.json

Cumulative API token usage. Persists across restarts.

## .kern/logs/

Log files from daemon mode (`kern start`). `kern.log` contains stdout/stderr.
