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

## kern import opencode \<name\>

Import a session from OpenCode into a kern agent.

- Finds OpenCode's SQLite database at `~/.local/share/opencode/opencode.db`
- Looks up sessions by agent's directory path
- Converts messages and tool calls to kern's ModelMessage format
- Validates tool-call/tool-result pairing
- Writes to `.kern/sessions/` as JSONL
- Accepts agent name (from registry) or directory path

```bash
kern import opencode myagent
kern import opencode /root/myagent
```

## kern run \<name|path\>

Run an agent in the foreground (for development/debugging). Starts all interfaces (Telegram, Slack) in-process.
