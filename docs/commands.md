# Commands

## kern

Show help and available commands.

## kern init \<name\>

Create a new agent or reconfigure an existing one.

**New agent**: interactive wizard asks for provider, API key, model, Telegram/Slack tokens. Scaffolds agent-kernel files (AGENTS.md, IDENTITY.md, KNOWLEDGE.md, USERS.md), creates `.kern/` config, initializes git, registers in `~/.kern/agents.json`, and starts the agent.

**Existing agent**: detects by name (from registry) or path. Shows current config with masked secrets. Update any field — press enter to keep current value. Restarts automatically after changes.

**Adopting an existing repo**: if the directory exists but has no `.kern/`, creates only `.kern/` config without overwriting existing AGENTS.md, IDENTITY.md, etc.

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
- Ctrl-C only exits TUI, daemon stays alive

## kern remove \<name\>

Unregister an agent. Stops it if running. Does not delete files.

Alias: `kern rm`

## kern run \<name|path\>

Run an agent in the foreground (for development/debugging). Starts all interfaces (Telegram, Slack) in-process.
