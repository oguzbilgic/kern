# Daemon Mode

Run kern as a foreground supervisor process. Manages agent lifecycles, restarts crashed agents, and shuts down cleanly on signals.

## Usage

```bash
# Supervise all registered agents
kern daemon

# Supervise a specific agent
kern daemon sentinel
kern daemon /path/to/agent
```

## Behavior

- Runs in the **foreground** -- does not detach or daemonize
- Spawns each agent as a child process (same as `kern start`)
- Monitors all children -- if an agent exits, the supervisor restarts it automatically
- On SIGTERM or SIGINT, stops all agents gracefully (10s timeout, then force kill)
- Registers PIDs and ports in `~/.kern/agents.json` like normal

## Auto-Restart

When an agent process exits unexpectedly:

1. Supervisor waits 2 seconds, then restarts it
2. If the agent was running for more than 60 seconds before crashing, the restart counter resets (agent was considered stable)
3. If the agent crashes 10 times without ever staying up for 60 seconds, the supervisor gives up on that agent
4. Other agents continue running normally

## Compared to `kern start`

| | `kern start` | `kern daemon` |
|---|---|---|
| Runs in | Background (detached) | Foreground (blocks) |
| Monitors agents | No -- fire and forget | Yes -- restarts on crash |
| Signal handling | N/A (exits immediately) | SIGTERM/SIGINT stops all agents |
| Container-friendly | No (exits, container dies) | Yes (stays alive as PID 1) |
| Use case | Local development | Production, Docker, systemd |

## Signals

| Signal | Behavior |
|---|---|
| SIGTERM | Graceful shutdown -- sends SIGTERM to all agents, waits up to 10s, then SIGKILL |
| SIGINT | Same as SIGTERM (Ctrl-C in terminal) |
| SIGHUP | Same as SIGTERM (terminal disconnect on Unix, console close on Windows) |

## systemd

```ini
[Unit]
Description=kern agent supervisor
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/kern daemon
Restart=on-failure
User=kern

[Install]
WantedBy=multi-user.target
```

## Logs

Supervisor logs to stderr with `[supervisor]` prefix (captured by `docker compose logs` or systemd journal). Agent logs go to their respective `.kern/logs/kern.log` files as usual.

```
2026-03-26T13:44:36.666Z [supervisor] starting in foreground mode
2026-03-26T13:44:36.682Z [supervisor] supervising 2 agent(s)
2026-03-26T13:44:36.727Z [supervisor] sentinel started (pid 54024)
2026-03-26T13:44:36.812Z [supervisor] oms-dev started (pid 54031)
2026-03-26T13:44:36.812Z [supervisor] all agents started, monitoring...
2026-03-26T13:45:12.001Z [supervisor] sentinel exited (code: 1, signal: null)
2026-03-26T13:45:14.002Z [supervisor] sentinel restarting in 2000ms (restart 1/10)
2026-03-26T13:45:16.005Z [supervisor] sentinel started (pid 54089)
```

For Docker and container deployment, see [deployment.md](deployment.md).
