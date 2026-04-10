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
| `name` | directory name | Agent name. Auto-set to directory basename on first startup if missing. Exposed in `/status` response. |
| `model` | `anthropic/claude-opus-4.6` | Model ID. Format depends on provider. |
| `provider` | `openrouter` | API provider: `openrouter`, `anthropic`, `openai`, `ollama` |
| `toolScope` | `full` | Tool access level: `full`, `write`, `read` |
| `maxSteps` | `30` | Max tool-use steps per message |
| `port` | auto | Fixed port for the agent HTTP server. Assigned automatically from 4100-4999 on creation or first start. |
| `maxContextTokens` | `100000` | Token budget for context window. Messages beyond this are trimmed oldest-first. Full history stays in session JSONL files. |
| `maxToolResultChars` | `20000` | Max characters per tool result in context. Oversized results are truncated in context only. Full results stay in session storage. Set to `0` to disable. |
| `telegramTools` | `false` | Show tool call progress lines (⚙ bash, etc.) in Telegram messages. |
| `heartbeatInterval` | `60` | Minutes between heartbeat prompts. Agent reviews notes, updates knowledge. 0 to disable. |
| `host` | `0.0.0.0` | Bind address for the agent's HTTP API. Default binds to all interfaces. Set to `127.0.0.1` for localhost only. |
| `hub` | *(none)* | Hub connection. `"default"` (kern.ai public hub), `"local"` (localhost:4000), or a custom hostname:port. Omit to disable. |
| `recall` | `true` | Enable recall and segments (embedding-based features). Set to `false` to disable. Requires an embedding API key. Session storage and notes summaries work regardless. |
| `summaryBudget` | `0.75` | Fraction of `maxContextTokens` for compressed conversation summaries from segments. Cached via prompt caching, so effectively free for supported models. Set to `0` to disable. See [Context](context.md#conversation-summary). |
| `autoRecall` | `false` | Automatically inject relevant old context before each turn. Requires recall enabled. |
| `mediaDigest` | `true` | Enable image pre-digest: describes images via vision model on arrival, caches descriptions, and replaces raw images with text in context. Set to `false` to disable the entire digest pipeline. |
| `mediaModel` | `""` | Vision model for media descriptions. Fallback chain: `mediaModel` → agent model → hardcoded provider default. Example: `"openai/gpt-4.1-mini"`. |
| `mediaContext` | `0` | How many recent turns resolve raw media Buffers to the model. `0` = never send raw binary (text descriptions or placeholders only). Applies to all media types — useful for non-image files like PDFs on models with native support. |

### Tool scopes

- **full** — bash, read, write, edit, glob, grep, webfetch, websearch, kern, message, recall, pdf, image
- **write** — read, write, edit, glob, grep, webfetch, websearch, kern, message, recall, pdf, image
- **read** — read, glob, grep, webfetch, websearch, kern, recall, pdf, image

### Providers

- **openrouter** — routes to cheapest provider. Model IDs like `anthropic/claude-opus-4.6`. Uses OpenAI-compatible chat completions API.
- **anthropic** — direct Anthropic API. Model IDs like `claude-opus-4-6-20260301`.
- **openai** — OpenAI or Azure. Model IDs like `gpt-4o`.
- **ollama** — local Ollama server. Model IDs match Ollama model names like `gemma4:31b`. Set `OLLAMA_BASE_URL` in `.env` for remote servers (default: `http://localhost:11434`).

## Per-agent: .kern/.env

Secrets. Gitignored. Never committed.

```
OPENROUTER_API_KEY=sk-or-...
OLLAMA_BASE_URL=http://localhost:11434
TELEGRAM_BOT_TOKEN=...
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
KERN_AUTH_TOKEN=...
```

Only set the API keys for providers/interfaces you use.

### Auth tokens

**`KERN_AUTH_TOKEN`** — per-agent Bearer token required on all agent API endpoints (except `/health`).

- Auto-generated on first agent start — written to `.kern/.env` automatically
- TUI and web proxy read it from the agent's `.kern/.env` automatically
- Web proxy injects it into proxied requests — the browser never sees agent tokens

**`KERN_PROXY_TOKEN`** — proxy auth token stored in `~/.kern/.env`.

- Auto-generated on first `kern proxy start`
- Required on all `/api/*` proxy routes (Bearer header or `?token=` query param)
- Printed by `kern proxy start` and `kern proxy token`
- Legacy `KERN_WEB_TOKEN` also accepted as fallback

You never need to set either token manually unless you want specific values.

## Global: ~/.kern/config.json

Global settings, agent registry, and service ports. Optional — defaults apply if the file doesn't exist.

```json
{
  "web_port": 8080,
  "proxy_port": 9000,
  "hub_port": 4000,
  "agents": ["/home/user/my-agent"]
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `web_port` | `8080` | Port for the `kern web` static file server. |
| `proxy_port` | `9000` | Port for the `kern proxy` authenticated reverse proxy. |
| `hub_port` | `4000` | Port for the `kern hub` server. |
| `agents` | `[]` | List of registered agent directory paths. Managed automatically by `kern init` and `kern start`. |

## .kern/ local files

SQLite database for agent memory. Always created on startup. Contains:

- `messages` — raw message content
- `chunks` — turn-level summaries for recall search
- `vec_chunks` — embeddings (sqlite-vec)
- `index_state` — tracks indexing progress per session
- `summaries` — cached notes summaries
- `semantic_segments` — hierarchical segment tree (L0, L1, L2...)
- `vec_segments` — segment embeddings
- `segment_state` — tracks segmentation progress per session

Gitignored. Safe to delete — rebuilds from session JSONL files on next start, summaries regenerate on next cache miss.

## .kern/sessions/

Conversation history as JSONL files. One file per session. First line is metadata, rest are messages. Gitignored.

## .kern/keys/

Ed25519 keypair for hub authentication. Generated on `kern init` or first agent start.

- `private.pem` — private key (mode 0600)
- `public.pem` — public key, shared with hub on connect

## .kern/pairing.json

Pending and paired user data for all interfaces (Telegram, Slack, Hub). Paired via the `kern` tool's `pair` action — agent handles pairing and updates USERS.md. Codes expire on restart. Paired users persist.

