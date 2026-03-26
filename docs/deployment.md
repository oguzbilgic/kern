# Deployment

How to run kern agents in Docker containers.

## Overview

The workflow: develop your agent locally with `kern init` and `kern start`, then package it into a Docker image for production. The agent's initial state is baked into the image and seeds a Docker volume on first run. After that, the agent persists its own state in the volume.

```
┌──────────────────────────────┐
│  Docker Container            │
│                              │
│  docker-entrypoint.sh        │
│    └── seeds /agent from     │
│        /agent-seed if empty  │
│                              │
│  kern daemon /agent          │
│    ├── supervisor            │
│    └── agent process         │
│         ├── Slack            │
│         ├── Telegram         │
│         └── HTTP :8080       │
│                              │
│  /agent (named volume)       │
│    ├── AGENTS.md             │
│    ├── IDENTITY.md           │
│    ├── knowledge/            │
│    ├── notes/                │
│    └── .kern/                │
└──────────────────────────────┘
```

## Quick Start

### 1. Init and develop locally

```bash
npm install -g kern-ai    # or build from source
mkdir ~/agents && cd ~/agents
kern init my-agent
kern tui my-agent          # test it works
kern stop my-agent
```

The wizard asks for provider, API key, model, and optional Slack/Telegram tokens. Iterate until the agent is working how you want.

### 2. Build the kern base image

```bash
git clone https://github.com/oguzbilgic/kern-ai.git
cd kern-ai
docker build -t kern-ai .
```

### 3. Build your agent image

Use the agent Dockerfile to bake your agent's state into an image. See [examples/Dockerfile.agent](examples/Dockerfile.agent).

```bash
cd ~/agents
docker build -f Dockerfile.agent -t my-agent \
  --build-arg KERN_IMAGE=kern-ai \
  --build-arg AGENT_DIR=./my-agent .
```

This copies your agent's files (identity, memory, knowledge, config) into the image as seed data. Secrets (`.kern/.env`) are excluded -- they're passed at runtime.

### 4. Create docker-compose.yaml

See [examples/docker-compose.yaml](examples/docker-compose.yaml) for the full template.

Secrets are read directly from the agent's `.kern/.env` file (created by the init wizard). No need to copy or duplicate secret files.

```yaml
env_file:
  - ./my-agent/.kern/.env
```

### 5. Run

```bash
docker compose up -d
```

On first run, the entrypoint seeds the volume from the baked-in agent state. On subsequent runs, the existing volume is used as-is.

### 6. Connect

```bash
# Register the remote once
kern remote add my-agent localhost:8080

# Chat
kern tui my-agent

# Or check health
curl localhost:8080/health
curl localhost:8080/status
```

## How Persistence Works

The agent's state lives in a Docker named volume mounted at `/agent`. On first run:

1. Entrypoint checks if `/agent/AGENTS.md` exists
2. If not (fresh volume), copies seed data from `/agent-seed/` (baked into the image)
3. Initializes git in the volume
4. Starts `kern daemon`

On subsequent runs, the volume already has data, so seeding is skipped. The agent reads and writes to the volume normally.

To re-seed (reset to initial state):

```bash
docker compose down -v     # removes volumes
docker compose up -d       # fresh seed
```

For off-host backup, configure the agent to push to a git remote. The agent already knows how to `git commit` and `git push` -- just add a remote in the volume:

```bash
docker exec kern-my-agent bash -c "cd /agent && git remote add origin <url> && git push -u origin master"
```

## Multiple Agents

Each agent gets its own container, its own volume, its own identity.

```yaml
services:
  sentinel:
    image: sentinel
    volumes:
      - sentinel-data:/agent
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
    image: oms-dev
    volumes:
      - oms-dev-data:/agent
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

volumes:
  sentinel-data:
  oms-dev-data:
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

If agents are logically grouped, they can share a container. Each agent needs its own port set in `.kern/config.json`:

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

Note: for multi-agent containers, agents must be registered before `kern daemon` can find them. Use a custom entrypoint or register during build.

## Port Configuration

Port priority (highest wins):

1. `port` in `.kern/config.json` -- per-agent, recommended for multi-agent setups
2. `KERN_PORT` environment variable -- per-container, good for single-agent containers
3. Random port -- default for local development

Same applies to `host` / `KERN_HOST`. Use `0.0.0.0` in containers so the port is reachable from outside.

## Secrets

API keys and tokens should never be baked into images. The agent Dockerfile explicitly strips `.kern/.env` from the seed data.

At runtime, compose reads secrets directly from each agent's `.kern/.env` -- the same file the init wizard created. No copies needed, secrets stay in one place:

```yaml
env_file:
  - ./my-agent/.kern/.env
```

For multi-agent setups, each agent points to its own `.kern/.env`:

```yaml
services:
  sentinel:
    env_file:
      - ./sentinel/.kern/.env
  oms-dev:
    env_file:
      - ./oms-dev/.kern/.env
```

Other options for production:
- **environment** -- set individually in compose or CI
- **Docker secrets** -- for swarm deployments

## Health Checks

Each agent exposes `GET /health` on its HTTP server:

```bash
curl http://localhost:8080/health
# {"ok":true,"uptime":123.45}
```

Docker compose healthcheck is included in all examples above. The `start_period` gives the agent time to boot and connect to Slack/Telegram before health checks begin.

## Updating an Agent

To update the agent's baked-in state (e.g., new identity, updated knowledge):

```bash
# Rebuild the agent image with new files
docker build -f Dockerfile.agent -t my-agent --build-arg AGENT_DIR=./my-agent .

# Recreate without removing volumes (existing state preserved)
docker compose up -d

# Or reset to new state
docker compose down -v && docker compose up -d
```

If the volume already has data, the seed is skipped. To force a re-seed, remove the volume first.

## Platform Notes

### Linux / macOS

No special setup. Docker runs natively, named volumes and compose work as shown above.

### Windows

kern and the Docker image target Linux containers. On Windows, you need a Linux Docker daemon -- either Docker Desktop (Linux containers mode) or a standalone Docker Engine in WSL2.

If your Docker daemon runs in WSL2, use a Docker context to route commands from your Windows terminal:

```bash
# Create context (one time)
docker context create wsl2 --docker "host=tcp://localhost:2375"

# Switch to it
docker context use wsl2
```

With named volumes, there are no path translation issues between Windows and WSL2. The `docker compose` command works from any terminal.

The `kern` CLI itself (TUI, remotes, etc.) works from any terminal regardless of platform.

## Logs

Supervisor logs to container stderr (visible via `docker compose logs`). Agent logs go to `.kern/logs/kern.log` inside the volume.

```bash
# Supervisor logs
docker compose logs -f

# Agent logs (exec into container)
docker exec kern-my-agent cat /agent/.kern/logs/kern.log
```
