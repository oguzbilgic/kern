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

- Runs in the **foreground** — does not detach or daemonize
- Spawns each agent as a child process (same as `kern start`)
- Monitors all children — if an agent exits, the supervisor restarts it automatically
- On SIGTERM or SIGINT, stops all agents gracefully (10s timeout, then force kill)
- Registers PIDs and ports in `~/.kern/agents.json` like normal

## Auto-Restart

When an agent process exits unexpectedly:

1. Supervisor waits 2 seconds, then restarts it
2. If the agent has been running for more than 60 seconds, the restart counter resets (agent was stable)
3. If the agent crashes more than 10 times within the restart window, the supervisor gives up on that agent
4. Other agents continue running normally

## Compared to `kern start`

| | `kern start` | `kern daemon` |
|---|---|---|
| Runs in | Background (detached) | Foreground (blocks) |
| Monitors agents | No — fire and forget | Yes — restarts on crash |
| Signal handling | N/A (exits immediately) | SIGTERM/SIGINT stops all agents |
| Container-friendly | No (exits, container dies) | Yes (stays alive as PID 1) |
| Use case | Local development | Production, Docker, systemd |

## Docker

`kern daemon` is designed as the container entrypoint:

```dockerfile
FROM node:22-slim

COPY kern-ai/ /opt/kern-ai/
WORKDIR /opt/kern-ai
RUN npm ci && npm run build && npm link

WORKDIR /agent
COPY my-agent/ /agent/

RUN apt-get update && apt-get install -y git curl && rm -rf /var/lib/apt/lists/*

CMD ["kern", "daemon", "/agent"]
```

For multiple agents in one container:

```dockerfile
COPY agents/oms-manager/ /agents/oms-manager/
COPY agents/oms-dev/ /agents/oms-dev/

# Register both agents during build
RUN kern start /agents/oms-manager && kern stop oms-manager && \
    kern start /agents/oms-dev && kern stop oms-dev

# Supervise all registered agents
CMD ["kern", "daemon"]
```

Docker Compose example:

```yaml
services:
  sentinel:
    build:
      context: .
      dockerfile: Dockerfile
    volumes:
      - ./sentinel:/agent
    environment:
      - KERN_PORT=8080
      - KERN_HOST=0.0.0.0
    env_file:
      - ./sentinel/.kern/.env
    ports:
      - "8080:8080"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `KERN_PORT` | `0` (random) | Fixed port for the agent's HTTP server |
| `KERN_HOST` | `127.0.0.1` | Bind address. Use `0.0.0.0` in containers |

## Health Check

Each agent exposes a `/health` endpoint on its HTTP server:

```bash
curl http://localhost:8080/health
# {"ok":true,"uptime":123.45}
```

Docker health check (with `KERN_PORT=8080`):

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s \
  CMD curl -f http://localhost:8080/health || exit 1
```

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

## Signals

| Signal | Behavior |
|---|---|
| SIGTERM | Graceful shutdown — sends SIGTERM to all agents, waits up to 10s, then SIGKILL |
| SIGINT | Same as SIGTERM (Ctrl-C in terminal) |
| SIGHUP | Same as SIGTERM (Windows console close) |

## Logs

Supervisor logs to stderr with `[supervisor]` prefix. Agent logs go to their respective `.kern/logs/kern.log` files as usual.

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
