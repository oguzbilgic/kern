# Commands

## kern

Show help and available commands.

## kern init \<name\>

Create a new agent or reconfigure an existing one.

**New agent**: interactive wizard asks for provider, API key, model, Telegram/Slack tokens. Scaffolds agent-kernel files (AGENTS.md, IDENTITY.md, KNOWLEDGE.md, USERS.md), creates `.kern/` config, initializes git, registers in `~/.kern/agents.json`, and starts the agent.

**Existing agent**: detects by name (from registry) or path. Shows current config with masked secrets. Update any field — press enter to keep current value. Restarts automatically after changes.

**Adopting an existing repo**: if the directory exists but has no `.kern/`, creates only `.kern/` config without overwriting existing AGENTS.md, IDENTITY.md, etc.

**Non-interactive mode**: pass `--api-key` to skip prompts. For automation and CI.

```bash
kern init my-agent --api-key sk-or-...
kern init my-agent --api-key sk-or-... --provider anthropic --model claude-opus-4.6
kern init my-agent --api-key sk-or-... --telegram-token 123:ABC --slack-bot-token xoxb-... --slack-app-token xapp-...
```

Defaults to openrouter + claude-opus-4.6 when flags are used.

## kern start [name|path]

Start agents as background daemons.

- No argument: starts all registered agents
- With name: starts that agent (looks up in registry)
- With path: auto-registers and starts (e.g. `kern start ./cloned-repo`)
- Waits 2 seconds after fork, verifies process is alive
- Shows error log if startup fails
- Writes PID and port to `~/.kern/agents.json`

## kern stop [name]

Stop agents.

- No argument: stops all running agents
- With name: stops that agent
- Sends SIGTERM, clears PID from registry

## kern restart [name]

Stop then start. 500ms delay between for clean shutdown.

## kern list

Show all registered agents with status.

- Green dot: running (shows PID and port)
- Dim dot: stopped
- Red dot: path not found
- Shows model, tool scope, session count

Aliases: `kern ls`, `kern status`

## kern tui [name]

Interactive terminal chat. Connects to running daemon via HTTP/SSE.

- No argument, one agent: auto-connects
- No argument, multiple agents: arrow-key select
- Auto-starts daemon if not running
- Cross-channel messages visible in real time
- Heartbeat activity visible
- Ctrl-C only exits TUI, daemon stays alive

## kern logs [name]

Tail agent logs in real time. Structured, colored output.

- No argument: auto-selects agent
- Logs stored in `.kern/logs/kern.log`
- Components: `[kern]` `[queue]` `[runtime]` `[telegram]` `[slack]` `[server]`
- Ctrl-C to stop

## kern remove \<name\>

Unregister an agent. Stops it if running. Does not delete files.

Alias: `kern rm`

## kern pair \<agent\> \<code\>

Approve a pairing code from the command line. No agent interaction needed.

```bash
kern pair atlas KERN-7X4M
```

## kern backup \<name\>

Backup an agent to a `.tar.gz` file.

- Creates `~/.kern/backups/{name}-{date}.tar.gz`
- Includes everything: AGENTS.md, IDENTITY.md, knowledge/, notes/, .kern/config.json, .kern/sessions/, .kern/.env, .kern/pairing.json
- Excludes: .kern/logs/
- Agent can be running during backup

## kern restore \<file\>

Restore an agent from a backup archive.

- Extracts to `./{agent-name}/` in the current directory
- Registers the agent in `~/.kern/agents.json`
- If agent already exists: warns and asks to confirm overwrite
- If agent is running: stops it before overwriting

## kern web \<start|stop|status|token\>

Manage the web UI server.

```bash
kern web start    # start web UI, prints URL with auth token
kern web stop     # stop it
kern web status   # check if running
kern web token    # print URL with auth token
```

- Serves the web UI and proxies all agent API requests
- Agents bind to `127.0.0.1` — only reachable through the proxy
- `KERN_WEB_TOKEN` auto-generated on first start, stored in `~/.kern/.env`
- All `/api/*` routes require the web token (Bearer header or `?token=` query param)
- `kern web start` and `kern web token` always print the full URL with token
- Port configurable in `~/.kern/config.json` (default 9000)
- PID tracked in `~/.kern/web.pid`, logs in `~/.kern/web.log`

## kern hub \<start|stop|status\>

Manage the agent-to-agent hub server.

```bash
kern hub start    # start hub server (daemonized)
kern hub stop     # stop it
kern hub status   # check if running
kern hub          # run in foreground (for debugging)
```

- WebSocket relay for agent-to-agent communication
- Agents authenticate via Ed25519 challenge-response on connect
- Assigns unique `kh_` IDs to agents on first registration
- Persistent agent registry at `~/.kern/hub/agents.json`
- HTTP dashboard at hub port showing agents, IDs, online status, message count
- API endpoints: `GET /api/agents`, `GET /api/stats`
- Port configurable via `hub_port` in `~/.kern/config.json` (default 4000)
- PID tracked in `~/.kern/hub/hub.pid`, logs in `~/.kern/hub/hub.log`

## kern import opencode

Import a session from OpenCode into a kern agent.

- Finds OpenCode's SQLite database at `~/.local/share/opencode/opencode.db`
- Interactive: prompts to select project, session, and target agent
- Converts messages and tool calls to kern's ModelMessage format
- Validates tool-call/tool-result pairing
- Writes to `.kern/sessions/` as JSONL

```bash
kern import opencode                          # interactive
kern import opencode /root/myproject          # specify project path
kern import opencode --agent atlas            # specify target agent
kern import opencode --project /root/myproject --session <id> --agent atlas
```

## Slash commands

Type these in any channel (TUI, Web, Telegram, Slack, Hub). Handled before the message queue — never sent to the LLM. Instant, zero tokens, works even when the queue is busy. Results are broadcast to all connected clients via SSE.

### /status

Show agent runtime status: model, uptime, session size, API usage, queue state, hub connection (URL, status, `kh_` ID), and interface connection status (Telegram, Slack).

### /restart

Restart the agent daemon.

- 2-second delay to let interfaces acknowledge the message before the process dies
- Registered as a Telegram bot command (shows in the `/` menu)
- Safe — no restart loops, no session corruption
- The agent cannot restart itself — it must ask the operator to type `/restart`
- Web UI auto-reconnects after restart (re-discovers the new agent port)

### /help

List available slash commands with descriptions.

## kern run \<name|path\>

Run an agent in the foreground (for development/debugging). Starts all interfaces (Telegram, Slack) in-process.
