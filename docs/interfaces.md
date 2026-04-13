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

Browser-based chat via the `kern web` static file server.

```bash
kern web start
```

- Interface: `web`, channel: `web`, user: `tui`
- Always the operator (no pairing required)
- Connect to agents directly from the sidebar by entering their URL and token

### Setup

```bash
kern web run      # run in foreground (for Docker)
kern web start    # start as background daemon
kern web stop     # stop daemon
kern web status   # check if running
```

### Architecture

- `kern web` serves only static files — no proxy, no auth
- Agents bind to `0.0.0.0` on sticky ports with their own auth tokens
- Connect to agents directly from the sidebar by entering their URL and token

### Authentication

`kern web` does not provide a separate authentication layer. It only serves the static Web UI.

Access control happens at the agent:

1. **Agent auth** — each agent has its own `KERN_AUTH_TOKEN` in `.kern/.env`, auto-generated on first agent start.

2. **Direct browser connection** — when connecting from the Web UI, users enter the agent URL and token in the sidebar. The browser connects to the agent directly.

### Agent discovery

- **Local agents** are auto-discovered from `~/.kern/config.json`
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
