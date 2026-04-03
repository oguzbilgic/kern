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

## kern install [name|--web]

Install systemd user services for agents and the web daemon. Provides auto-restart on crash and boot persistence.

- No argument: installs all registered agents + web
- With name: installs a single agent
- `--web`: installs only the web daemon
- Migrates from PID-based daemon: stops existing process before installing
- Warns if `loginctl enable-linger` is not enabled (required for services to survive logout)
- Idempotent — safe to run again after adding new agents

Services are written to `~/.config/systemd/user/`:
- `kern-agent-<name>.service` for each agent
- `kern-web.service` for the web daemon

```bash
kern install          # all agents + web
kern install atlas    # single agent
kern install --web    # web only
```

Requires Linux with systemd. On systems without systemd, use `kern start` instead.

## kern uninstall [name]

Remove systemd services installed by `kern install`.

- No argument: uninstalls all agent services + web
- With name: uninstalls a single agent service
- Stops and disables the service, deletes the unit file

```bash
kern uninstall        # all
kern uninstall atlas  # single agent
```

## kern start [name|path]

Start agents as background daemons.

- No argument: starts all registered agents
- With name: starts that agent (looks up in registry)
- With path: auto-registers and starts (e.g. `kern start ./cloned-repo`)
- Waits 2 seconds after fork, verifies process is alive
- Shows error log if startup fails
- Writes PID and port to `~/.kern/agents.json`
- If a systemd service is installed for the agent, delegates to `systemctl --user start`

## kern stop [name]

Stop agents.

- No argument: stops all running agents
- With name: stops that agent
- Sends SIGTERM, clears PID from registry
- If a systemd service is installed, delegates to `systemctl --user stop`

## kern restart [name]

Stop then start. 500ms delay between for clean shutdown. Delegates to systemd when installed.

## kern list

Show all registered agents and the web daemon with status.

- Green dot: running (shows PID and port)
- Dim dot: stopped
- Red dot: path not found
- Shows model, tool scope, and mode (systemd/daemon/—)
- Shows web daemon status and port

Aliases: `kern ls`, `kern status`

## kern tui [name]

Interactive terminal chat. Connects to running daemon via HTTP/SSE.

- No argument, one agent: auto-connects
- No argument, multiple agents: arrow-key select
- Auto-starts daemon if not running
- Cross-channel messages visible in real time
- Heartbeat activity visible
- Ctrl-C only exits TUI, daemon stays alive

## kern logs [name] [-f] [-n N] [--level LEVEL]

Follow agent logs. Structured, leveled, colored output.

- No argument: auto-selects agent
- Default: follow mode (like `tail -f`). `-n 50` shows last 50 lines and exits.
- `--level warn` filters to warnings and errors only. Levels: `debug`, `info`, `warn`, `error`.
- Logs stored in `.kern/logs/kern.log`
- Components: `[kern]` `[queue]` `[runtime]` `[context]` `[telegram]` `[slack]` `[server]` `[recall]` `[segments]` `[notes]` `[config]` `[memory]`
- Level labels: `ERR` (red), `WRN` (yellow), `DBG` (dim). Info has no label.

## kern remove \<name\>

Unregister an agent. Uninstalls systemd service if installed, stops it if running. Does not delete files.

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
- If installed via `kern install`, start/stop/restart delegate to systemd

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

Type these in any channel (TUI, Web, Telegram, Slack). Handled by the runtime at the queue level — never sent to the LLM. Instant, zero tokens. Results are broadcast to all connected clients via SSE.

### /status

Show agent runtime status: model, uptime, session size, API usage, queue state, and interface connection status (Telegram, Slack).

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
