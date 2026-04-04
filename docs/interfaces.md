# Interfaces

kern supports multiple interfaces simultaneously. Each agent runs as a daemon with all configured interfaces active.

## TUI

Interactive terminal chat. Connects to a running daemon via HTTP/SSE.

```bash
kern tui [name]
```

- Always the operator (the person who created the agent)
- Auto-starts daemon if not running
- Auto-selects agent if only one registered
- Shows cross-channel messages in real time
- Renders Markdown (code blocks, quotes, bold, italic)
- Live connection indicator (`●`/`○`) that automatically reconnects
- **Mid-turn messaging** — input stays enabled while agent is working. Messages are injected between tool steps.
- Ctrl-C only kills TUI, daemon stays alive

Message styling (colored left borders):
- **green** — your input and outgoing messages to other channels
- **yellow** — incoming from other channels (Telegram, Slack, Web)
- **magenta** — heartbeat
- Assistant responses are plain text, indented
- Tool calls are color-coded by tool name (bash=red, read=cyan, write=green, edit=yellow, glob=magenta, grep=blue)

## Web UI

Browser-based chat interface. Runs as a separate process from agents — `kern web` serves the UI, agents serve their APIs.

### Setup

```bash
kern web start    # start web UI, prints URL with token
kern web stop     # stop it
kern web status   # check if running
kern web token    # print URL with token again
```

`kern web start` prints a URL with the auth token. Open it to connect:

```
  ● web started (pid 12345, port 9000)
  → http://localhost:9000?token=abc123...
```

Over Tailscale or LAN, use the machine's hostname or IP with the same token.

### Architecture

- `kern web` serves the HTML page and proxies all API requests to agents
- Agents bind to `127.0.0.1` on random ports — only reachable locally via the proxy
- The web proxy injects agent auth tokens automatically — the browser never sees them
- Single `KERN_WEB_TOKEN` protects the proxy layer

### Agent discovery

- **Local agents** are auto-discovered from `~/.kern/agents.json`. The sidebar shows them grouped under the local server.
- **Remote servers** can be added in the sidebar ("Add server" with URL + token). Agents on remote servers are fetched and grouped by server hostname. Stored in browser localStorage.

### Authentication

Two layers:

1. **Web proxy auth** — `KERN_WEB_TOKEN` in `~/.kern/.env`, auto-generated on first `kern web start`. Required on all `/api/*` routes. Web UI prompts for it on first visit, saves to localStorage. Logout button in sidebar clears it.

2. **Agent auth** — per-agent `KERN_AUTH_TOKEN` in `.kern/.env`, auto-generated on first agent start. The web proxy reads these from `~/.kern/agents.json` and injects them into proxied requests. Users never interact with agent tokens.

### Features

- **Agent sidebar** — left panel with agents grouped by server, online/offline status dots, collapsible on desktop, slide-out on mobile
- **Slash commands** — `/status`, `/restart`, `/help` with autocomplete popup
- **Collapsible tool output** — click a tool call to expand and see the result. Edit tools show inline diffs (red/green).
- **TUI-style message colors** — user (blue), incoming from Telegram/Slack (yellow), outgoing (green), heartbeat (magenta), per-tool colors
- **Streaming responses** with live cursor and thinking indicator
- **Mid-turn messaging** — input stays enabled while agent is working. Send follow-up messages or corrections that get injected between tool steps.
- **Full history** on connect, including tool call results
- **Agent info panel** — version, model, tools, Telegram/Slack connection status, uptime, session stats, API usage, queue state, connection string with copy
- **Auto-reconnect** — re-discovers agent port after restart
- **Context inspection overlays** — inspect semantic segments and the fully composed system prompt from the info panel
  - Segments overlay supports `All` / `Context` filters, live refresh during rebuilds, per-segment resummarization, and markdown-rendered summaries
  - System prompt overlay supports `Markdown` and `Raw` views for the composed prompt
- **Dark theme**, mobile-friendly, PWA support

### Global config

Web server port and host are configured in `~/.kern/config.json`:

```json
{
  "web_port": 9000,
  "web_host": "0.0.0.0"
}
```

Optional — defaults apply if the file doesn't exist.

## Telegram

Long polling bot. Works behind NAT, no public URL needed.

### Setup

1. Message @BotFather on Telegram, create a bot, get the token
2. Add `TELEGRAM_BOT_TOKEN=...` to `.kern/.env`
3. Restart the agent

### Behavior

- Unpaired users get a pairing code
- Paired users can chat normally
- Responses stream with typing indicator
- Tool calls shown live (⚙), replaced by response
- Markdown converted to Telegram HTML
- Connection status reported in `/status` (connected/disconnected/error)
- Graceful shutdown: polling stops cleanly on SIGTERM — no 409 conflicts on restart
- If a 409 conflict occurs (e.g. rapid restart), retries automatically after 5 seconds

## Slack

Socket Mode connection. No public URL needed.

### Setup

1. Create a Slack app at https://api.slack.com/apps
2. Enable **Socket Mode** in the app settings — generates an app-level token (`xapp-...`)
3. Add bot token scopes:
   - `chat:write` — send messages
   - `channels:read` — read channel info
   - `channels:history` — read channel messages
   - `groups:read` — read private channel info
   - `groups:history` — read private channel messages
   - `im:read` — read DM info
   - `im:write` — send DMs
   - `im:history` — read DM history
4. Install the app to your workspace — get bot token (`xoxb-...`)
5. Subscribe to bot events:
   - `message.channels` — messages in public channels
   - `message.groups` — messages in private channels
   - `message.im` — direct messages
6. Add tokens to `.kern/.env`:
   ```
   SLACK_BOT_TOKEN=xoxb-...
   SLACK_APP_TOKEN=xapp-...
   ```
7. Invite the bot to channels where it should listen
8. Restart the agent

### Behavior

- **DMs**: pairing required. Unpaired users get a code.
- **Channels**: agent reads ALL messages but only responds when @mentioned or directly relevant. Returns `NO_REPLY` to suppress silent messages.
- **Replies**: all replies post directly to the channel or DM (no threading).
- Agent can send proactive messages via the `message` tool.
- Connection status reported in `/status` (connected/disconnected/error).
- Graceful shutdown: Socket Mode connection closes cleanly on SIGTERM.
