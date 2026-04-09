# Architecture

How kern's processes fit together.

## Overview

```
Browser ──→ kern web (:9000) ──→ agent A (:random)
                               ├─→ agent B (:random)
                               └─→ agent C (:random)

TUI ──────────────────────────→ agent A (:random)
Telegram ←────────────────────→ agent A (long poll)
Slack ←───────────────────────→ agent A (socket mode)
```

Each agent is a separate process. The web server is a separate process. They communicate over HTTP on localhost.

## Agent process

`kern start` launches an agent as a background daemon. Each agent process:

- Binds an HTTP server to `127.0.0.1` on a **random port** (OS-assigned)
- Registers its path in `~/.kern/config.json` and writes PID to its own `.kern/agent.pid`
- Connects to Telegram (long polling) and/or Slack (socket mode) if tokens are configured
- Runs the message queue, tool executor, and model calls
- Serves SSE for real-time streaming to connected clients (TUI, web UI)

The agent never binds to `0.0.0.0` — it's only reachable from localhost. All external access goes through the web proxy.

### Agent HTTP endpoints

These are internal — the web proxy forwards to them, TUI connects directly.

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/events` | GET | SSE stream (messages, tool calls, status) |
| `/message` | POST | Send a message to the agent |
| `/status` | GET | Agent status, model, uptime, token counts |
| `/history` | GET | Message history with pagination |
| `/health` | GET | Liveness check |
| `/segments` | GET | Semantic segment data |
| `/segments/rebuild` | POST | Trigger segment re-indexing |
| `/context/system` | GET | Full composed system prompt |
| `/context/segments` | GET | Segments currently in context |
| `/sessions` | GET | Session list with current session ID |
| `/recall/stats` | GET | Recall index stats |

### Auth

Each agent generates a random token on first start, stored in `.kern/.env` as `KERN_AUTH_TOKEN`. Every request must include `Authorization: Bearer <token>`. The TUI and web proxy read the token from the agent's `.kern/.env` file.

## Web server

`kern web start` launches a separate HTTP server (default port 9000, configurable in `~/.kern/config.json`).

It serves two things:
1. **Static files** — the web UI (HTML, CSS, JS)
2. **Agent proxy** — forwards `/api/agents/:name/*` to the correct agent process

### Proxy flow

```
Browser → GET /api/agents/vega/status
       → kern web reads ~/.kern/config.json agents list
       → finds vega: { port: 34521, token: "abc..." }
       → forwards to 127.0.0.1:34521/status with Authorization header
       → streams response back to browser
```

The browser never knows agent ports or tokens. It authenticates once with `KERN_WEB_TOKEN` (auto-generated, stored in `~/.kern/.env`), and the proxy handles the rest.

### Web auth

A single token (`KERN_WEB_TOKEN`) protects the web server. It's generated on first `kern web start` and printed as part of the URL:

```
http://100.115.98.30:9000?token=abc123...
```

The browser stores this token and sends it with every request. No per-agent auth from the browser side — the proxy injects agent tokens internally.

## Registry

`~/.kern/config.json` is the coordination point. Every agent registers its path on start:

```json
{
  "web_port": 9000,
  "agents": ["/root/vega", "/home/kern/atlas"]
}
```

The web server and TUI read this file to discover agents, then read each agent's `.kern/` directory for port, token, and PID. `kern list` reads it to show status. PIDs are checked with `kill -0` to detect stale entries.

## TUI

`kern tui [name]` connects directly to an agent's HTTP server — no web proxy involved. It reads the agent's port and token from the agent's `.kern/` directory, opens an SSE connection for streaming, and sends messages via POST. It's a direct localhost connection.

## Telegram & Slack

These run inside the agent process itself — not separate services.

- **Telegram**: grammY bot with long polling. No incoming port needed.
- **Slack**: Bolt with Socket Mode. No incoming port needed.

Both inject messages into the same queue as TUI and web. The agent doesn't know or care which interface a message came from — it sees metadata tags like `[via telegram, user: oguz]`.

## Service management

`kern install` creates systemd user services for agents and the web server. This gives you:

- Auto-restart on crash
- Start on boot (with lingering enabled)
- Standard `systemctl --user` management

```bash
kern install vega       # install agent as systemd service
kern install --web      # install web server as systemd service
kern uninstall vega     # remove service
```

Without `kern install`, agents run as plain daemons managed by PID files.

## File layout

```
~/.kern/
  config.json          # global config + agent registry
  config.json          # global config (web port, host)
  .env                 # KERN_WEB_TOKEN
  web.pid              # web server PID

~/my-agent/
  .kern/
    config.json        # agent config (model, provider, toolScope)
    .env               # API keys, bot tokens, KERN_AGENT_TOKEN
    sessions/          # conversation JSONL
    recall.db          # memory database (embeddings, segments, summaries)
    logs/              # structured logs
  AGENTS.md            # agent behavior
  IDENTITY.md          # agent identity
  KNOWLEDGE.md         # knowledge index
  USERS.md             # paired users
  knowledge/           # mutable state files
  notes/               # daily logs
```

## Port summary

| Process | Binds to | Port | Accessible from |
|---------|----------|------|-----------------|
| Agent | 127.0.0.1 | random | localhost only |
| Web server | 0.0.0.0 (configurable) | 9000 (configurable) | LAN / Tailscale |
| Telegram | outbound only | — | — |
| Slack | outbound only | — | — |
