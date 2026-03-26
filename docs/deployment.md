# Deployment

How to run kern agents in Docker containers.

## Overview

Each agent is a folder with identity, memory, and config files. The kern Docker image provides the runtime. You mount your agent folder into the container and kern runs it.

```
┌─────────────────────────┐
│  Docker Container       │
│                         │
│  kern daemon /agent     │
│    ├── supervisor       │
│    └── agent process    │
│         ├── Slack       │
│         ├── Telegram    │
│         └── HTTP :8080  │
│                         │
│  /agent (mounted)       │
│    ├── AGENTS.md        │
│    ├── IDENTITY.md      │
│    ├── knowledge/       │
│    ├── notes/           │
│    └── .kern/           │
└─────────────────────────┘
```

## Quick Start

### 1. Init an agent

```bash
npm install -g kern-ai    # or build from source
mkdir ~/agents && cd ~/agents
kern init my-agent
```

The wizard asks for provider, API key, model, and optional Slack/Telegram tokens.

### 2. Build the Docker image

```bash
git clone https://github.com/oguzbilgic/kern-ai.git
cd kern-ai
docker build -t kern-ai .
```

### 3. Create docker-compose.yaml

Copy the example and update paths for your agent:

```bash
cp docs/examples/docker-compose.yaml ./docker-compose.yaml
```

See [examples/docker-compose.yaml](examples/docker-compose.yaml) for the full template.

### 4. Run

```bash
docker compose up -d
```

### 5. Connect

```bash
# Register the remote once
kern remote add my-agent localhost:8080

# Chat
kern tui my-agent

# Or check health
curl localhost:8080/health
curl localhost:8080/status
```

## Multiple Agents

Each agent gets its own container, its own port, its own identity.

```yaml
services:
  sentinel:
    image: kern-ai
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

  oms-dev:
    image: kern-ai
    volumes:
      - ./oms-dev:/agent
    environment:
      - KERN_PORT=8080
      - KERN_HOST=0.0.0.0
    env_file:
      - ./oms-dev/.kern/.env
    ports:
      - "8081:8080"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
```

Register remotes and connect:

```bash
kern remote add sentinel localhost:8080
kern remote add oms-dev localhost:8081

kern tui sentinel
kern tui oms-dev
```

Agents communicate with each other through shared Slack channels, not internal APIs. Same as a human team.

## Multiple Agents in One Container

If agents are logically grouped (e.g., an OMS manager + dev pair), they can share a container. Each agent needs its own port set in `.kern/config.json`:

**oms-manager/.kern/config.json:**
```json
{
  "model": "claude-opus-4-6",
  "provider": "anthropic",
  "port": 8080,
  "toolScope": "full",
  "maxSteps": 30
}
```

**oms-dev/.kern/config.json:**
```json
{
  "model": "claude-opus-4-6",
  "provider": "anthropic",
  "port": 8081,
  "toolScope": "full",
  "maxSteps": 30
}
```

```yaml
services:
  oms:
    image: kern-ai
    volumes:
      - ./oms-manager:/agents/oms-manager
      - ./oms-dev:/agents/oms-dev
    environment:
      - KERN_HOST=0.0.0.0
    env_file:
      - ./oms-manager/.kern/.env
    ports:
      - "8080:8080"
      - "8081:8081"
    command: ["kern", "daemon"]
    restart: unless-stopped
```

Note: for multi-agent containers, agents must be registered before `kern daemon` can find them. Either register during build or use a custom entrypoint:

```dockerfile
CMD kern start /agents/oms-manager && kern stop oms-manager && \
    kern start /agents/oms-dev && kern stop oms-dev && \
    kern daemon
```

## Port Configuration

Port priority (highest wins):

1. `port` in `.kern/config.json` — per-agent, recommended for multi-agent setups
2. `KERN_PORT` environment variable — per-container, good for single-agent containers
3. Random port — default for local development

Same applies to `host` / `KERN_HOST`. Use `0.0.0.0` in containers so the port is reachable from outside.

## Secrets

API keys and tokens live in `.kern/.env`, which is gitignored. Pass them to containers via:

- **env_file** — mount the `.env` file (shown in examples above)
- **environment** — set individually in compose
- **Docker secrets** — for production / swarm deployments

Never bake secrets into the Docker image.

## Persistence

Agent state (identity, memory, notes, config) is in the mounted agent folder. Sessions are in `.kern/sessions/`. Both persist as long as the mount exists.

For volume-backed sessions:

```yaml
volumes:
  - ./my-agent:/agent
  - my-agent-sessions:/agent/.kern/sessions

volumes:
  my-agent-sessions:
```

## Health Checks

Each agent exposes `GET /health` on its HTTP server:

```bash
curl http://localhost:8080/health
# {"ok":true,"uptime":123.45}
```

Docker compose healthcheck is included in all examples above. The `start_period` gives the agent time to boot and connect to Slack/Telegram before health checks begin.

## WSL2 (Windows + Linux Containers)

If running Docker via WSL2 on Windows, set the Docker context first:

```powershell
docker context use wsl2-docker
```

Run compose from WSL to avoid Windows path issues:

```powershell
wsl -e bash -c "cd /mnt/c/work/agents && docker compose up -d"
```

TUI and remote commands work from PowerShell as normal:

```powershell
kern remote add my-agent localhost:8080
kern tui my-agent
```

## Logs

Supervisor logs to container stdout (visible via `docker compose logs`). Agent logs go to `.kern/logs/kern.log` inside the mounted volume.

```bash
# Supervisor logs
docker compose logs -f

# Agent logs
kern logs my-agent           # if registered locally
cat ./my-agent/.kern/logs/kern.log  # direct file access
```
