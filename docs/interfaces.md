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
- Ctrl-C only kills TUI, daemon stays alive

Markers:
- `>` green — your input
- `◆` blue — agent response
- `◇` yellow — incoming from other channels
- `→` green — agent sent a message to a channel

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
