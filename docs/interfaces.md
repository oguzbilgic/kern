# Interfaces

kern supports multiple interfaces simultaneously. Every interface feeds into the same session with consistent metadata.

## Message metadata

All messages include context metadata prepended to the text:

```
[via <interface>, <channel>, user: <id>, time: <iso8601>]
```

Examples:

```
[via telegram, telegram:12345, user: 8105113489, time: 2026-04-06T21:30:00Z]
[via slack, #engineering, user: U04ABC, time: 2026-04-06T21:30:00Z]
[via web, web, user: tui, time: 2026-04-06T21:30:00Z]
[via tui, tui, user: tui, time: 2026-04-06T21:30:00Z]
```

The agent sees who's talking, from which channel, and when — and adapts behavior accordingly via instructions in `KERN.md`.

## TUI

Interactive terminal chat. Connects to a running agent via HTTP/SSE.

```bash
kern tui [name]
```

- Interface: `tui`, channel: `tui`, user: `tui`
- Always the operator (no pairing required)
- Auto-starts agent if not running
- Auto-selects agent if only one registered

## Web UI

Browser-based chat via the `kern web` proxy server.

```bash
kern web start
```

- Interface: `web`, channel: `web`, user: `tui`
- Always the operator (no pairing required)
- Connects through web proxy with token auth

### Setup

```bash
kern web start    # start web UI, prints URL with token
kern web stop     # stop it
kern web status   # check if running
kern web token    # print URL with token again
```

### Architecture

- `kern web` serves the HTML page and proxies all API requests to agents
- Agents bind to `127.0.0.1` on random ports — only reachable locally via the proxy
- The web proxy injects agent auth tokens automatically — the browser never sees them
- Single `KERN_WEB_TOKEN` protects the proxy layer

### Authentication

Two layers:

1. **Web proxy auth** — `KERN_WEB_TOKEN` in `~/.kern/.env`, auto-generated on first `kern web start`. Required on all `/api/*` routes. Web UI prompts for it on first visit, saves to localStorage.

2. **Agent auth** — per-agent `KERN_AUTH_TOKEN` in `.kern/.env`, auto-generated on first agent start. The web proxy injects them into proxied requests. Users never interact with agent tokens.

### Agent discovery

- **Local agents** are auto-discovered from `~/.kern/agents.json`
- **Remote servers** can be added in the sidebar ("Add server" with URL + token)

### Global config

```json
{
  "web_port": 9000,
  "web_host": "0.0.0.0"
}
```

Stored in `~/.kern/config.json`. Optional — defaults apply if missing.

## Telegram

Long polling bot. Works behind NAT, no public URL needed.

- Interface: `telegram`, channel: `telegram:<chatId>`, user: `<telegramUserId>`

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
- Graceful shutdown: polling stops cleanly on SIGTERM
- 409 conflicts auto-retry after 5 seconds

## Slack

Socket Mode connection. No public URL needed.

- Interface: `slack`, channel: `#channel-name` or `slack-dm`, user: `<slackUserId>`

### Setup

1. Create a Slack app at https://api.slack.com/apps
2. Enable **Socket Mode** — generates an app-level token (`xapp-...`)
3. Add bot token scopes:
   - `chat:write`, `channels:read`, `channels:history`
   - `groups:read`, `groups:history`
   - `im:read`, `im:write`, `im:history`
4. Install the app to your workspace — get bot token (`xoxb-...`)
5. Subscribe to bot events:
   - `message.channels`, `message.groups`, `message.im`
6. Add tokens to `.kern/.env`:
   ```
   SLACK_BOT_TOKEN=xoxb-...
   SLACK_APP_TOKEN=xapp-...
   ```
7. Invite the bot to channels
8. Restart the agent

### Behavior

- **DMs**: pairing required. Unpaired users get a code.
- **Channels**: reads ALL messages, only responds when @mentioned or directly relevant. Returns `NO_REPLY` to suppress.
- **Replies**: post directly to channel or DM (no threading).
- Graceful shutdown: Socket Mode closes cleanly on SIGTERM.
