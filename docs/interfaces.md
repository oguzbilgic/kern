# Interfaces

kern supports multiple interfaces simultaneously. Every interface feeds into the same session with consistent metadata.

## Message metadata

All messages include context metadata prepended to the text:

```
[via <interface>, <channel>, user: <id>, time: <iso8601>]
```

Examples:

```
[via telegram, telegram:12345, user: 8105113489, time: 2026-04-06T14:30:00-07:00]
[via slack, #engineering, user: U04ABC, time: 2026-04-06T14:30:00-07:00]
[via matrix, matrix:!abc:example.com, user: @oguz:example.com, time: 2026-04-16T21:00:00-07:00]
[via web, web, user: tui, time: 2026-04-06T14:30:00-07:00]
[via tui, tui, user: tui, time: 2026-04-06T14:30:00-07:00]
```

The `time:` field is ISO 8601 in the host's local timezone with UTC offset. Override with the `timezone` config field (see [config](config.md)). Storage (logs, recall, session metadata) stays UTC regardless.

The agent sees who's talking, from which channel, and when — and adapts behavior accordingly via instructions in `KERN.md`.

## Metadata contract

The same metadata flows through three parallel surfaces. Every interface populates them, and every client consumes them.

### Surface 1 — Agent-facing text prefix

The text prefix described above (`[via <interface>, <channel>, user: <id>, time: <iso8601>]`) is prepended to every message before the model sees it. Built in `src/app.ts` from the internal message object fields. See the [Message metadata](#message-metadata) section for examples.

### Surface 2 — Internal message object

Messages enter the runtime via two paths:

**Adapter interfaces** (`src/interfaces/telegram.ts`, `slack.ts`, `matrix.ts`, `cli.ts`) construct an `IncomingMessage` (defined in `src/interfaces/types.ts`) and pass it to their `onMessage` callback:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `text` | `string` | yes | Message body |
| `userId` | `string` | yes | Sender identifier (platform-specific) |
| `chatId` | `string` | yes | Conversation/room identifier (platform-specific) |
| `interface` | `string` | yes | Interface name — for example `telegram`, `slack`, `matrix`, `cli` |
| `channel` | `string` | no | Human-readable channel label used in the text prefix and SSE events |
| `attachments` | `Attachment[]` | no | Media files attached to the message |

**HTTP clients** (web UI, TUI) POST to the agent's `/message` endpoint with a flat JSON payload. The server maps fields directly into the runtime; there is no `chatId` on this path.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `text` | `string` | yes (unless `attachments`) | Message body |
| `userId` | `string` | no (defaults to `"tui"`) | Sender identifier |
| `interface` | `string` | no (defaults to `"tui"`) | Interface name, typically `"web"` or `"tui"` |
| `channel` | `string` | no (defaults to `"tui"`) | Channel label |
| `attachments` | `Attachment[]` | no | Base64-encoded attachments |
| `connectionId` | `string` | no | SSE connection ID to exclude from the echo broadcast |

The runtime itself also synthesizes `interface: "system"` for heartbeat messages (`src/app.ts`).

### Surface 3 — SSE broadcast events

When a message arrives, the server broadcasts an SSE event to all connected clients (web UI, TUI, other tabs). Two event types carry metadata:

**`incoming`** — a message received from any interface:

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"incoming"` | Event discriminator |
| `text` | `string` | Message body |
| `fromInterface` | `string?` | Source interface name (for example `telegram`, `slack`, `matrix`, `web`, `tui`, `cli`) |
| `fromUserId` | `string?` | Sender identifier |
| `fromChannel` | `string?` | Channel label |
| `media` | `MediaItem[]?` | Attached media (images/files as data URLs) |

**`outgoing`** — a message sent by the agent to an external interface via the `message` tool:

| Field | Type | Description |
|-------|------|-------------|
| `type` | `"outgoing"` | Event discriminator |
| `text` | `string` | Message body |
| `fromInterface` | `string?` | Target interface the message was sent to |
| `fromUserId` | `string?` | Target/recipient user identifier. Despite the `from*` name, this is the message's destination, not its origin. |

On the client side, the `StreamEvent` discriminated union in `web/lib/types.ts` models these SSE payloads. On the server side, `src/server.ts` defines `ServerEvent` (extends `StreamEvent` from `src/runtime.ts`).

### Per-interface population

How each interface populates the internal message fields and SSE events:

| Interface | `userId` | `chatId` | `channel` | `fromInterface` (SSE) |
|-----------|----------|----------|-----------|----------------------|
| telegram | `msg.from.id` (stringified) | `msg.chat.id` (stringified) | `telegram:<chatId>` | `telegram` |
| slack | `message.user` | `message.channel` | `#<name>` (channel) or `slack-dm` (DM) | `slack` |
| matrix | `event.sender` (mxid) | `roomId` | `matrix:<roomId>` | `matrix` |
| cli | `"cli"` | `"cli"` | `"terminal"` | `cli` |
| tui | `"tui"` | — | `"tui"` | `tui` |
| web | `"tui"` | — | `"web"` | `web` |

Notes:
- Slack channel names are resolved via `conversations.info` — DMs use `slack-dm`, channels use `#<channel-name>`.
- Matrix room IDs are opaque (`!abc:example.com`); the channel label prefixes them with `matrix:`.
- TUI and web submit messages over HTTP without a `chatId` — they always represent the operator.

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

## Matrix

Long-polled `/sync` against a Matrix homeserver (Synapse, Dendrite, Conduit, etc.). Works against public servers or a tailnet-local homeserver.

- Interface: `matrix`, channel: `matrix:<roomId>`, user: `<mxid>` (e.g. `@alice:example.com`)

### Setup

1. Create a user on your Matrix homeserver for the agent (admin `create-account`, shared-secret registration, or normal signup if open).
2. Log in once to grab an access token:
   ```bash
   curl -X POST https://matrix.example.com/_matrix/client/v3/login \
     -d '{"type":"m.login.password","identifier":{"type":"m.id.user","user":"myagent"},"password":"..."}'
   ```
3. Add to `.kern/.env`:
   ```
   MATRIX_HOMESERVER=https://matrix.example.com
   MATRIX_USER_ID=@myagent:example.com
   MATRIX_ACCESS_TOKEN=syt_...
   ```
4. Restart the agent. Invite it to a room from any Matrix client.

### Behavior

- Auto-accepts invites to rooms it's invited to
- Sends typing indicators while thinking
- Replies as plain `m.text` messages
- **Pairing required everywhere.** Unpaired users (in DMs or group rooms) get a pairing code (same flow as Telegram/Slack). The code is sent once per `(user, room)` pair to avoid spam. This differs from Slack channels, which accept messages from any workspace member — Matrix rooms can span homeservers and federations, so kern treats every unknown sender as untrusted.
- **Group room behavior.** Once paired, responses follow the `KERN.md` group-room rules (mirrors Slack channel behavior). `NO_REPLY` to stay quiet.
- **Agents in shared rooms**: first-class — two kern agents can DM each other or coexist in a group room. Pairing codes auto-issue; operator approves via CLI.

### Limitations (MVP)

- **No E2E encryption.** Rooms with `m.room.encryption` state are joined but messages are skipped. Create unencrypted rooms for agents (Element: turn off encryption in room create advanced options).
- **No media.** Images, files, voice messages pass through silently.
- **No reactions, edits, threads, or replies.** Plain text turns only.
