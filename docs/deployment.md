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

Use the agent Dockerfile to bake your agent's state into an image. Copy it into your agents directory first:

```bash
cd ~/agents
cp /path/to/kern-ai/docs/examples/Dockerfile.agent .
docker build -f Dockerfile.agent -t my-agent \
  --build-arg AGENT_DIR=./my-agent .
```

See [examples/Dockerfile.agent](examples/Dockerfile.agent) for details.

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

For off-host backup, see [Git Sync](#git-sync) below.

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
      start_period: 30s

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
      start_period: 30s

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

## Runtime Dependencies

In Docker, only `/agent` (the volume) persists across restarts. System packages installed with `apt-get` are lost when the container restarts. Three options:

### Persistent local bin

The agent can install standalone binaries to `/agent/.local/bin/`. The entrypoint adds this to `PATH` on startup. This directory is gitignored.

```bash
# Agent installs a tool at runtime
mkdir -p /agent/.local/bin
curl -o /agent/.local/bin/mytool https://...
chmod +x /agent/.local/bin/mytool
```

### Init script

The agent can create `.kern/init.sh` to install system packages on every container start. This runs before the agent process. Gitignored.

```bash
#!/bin/sh
apt-get update && apt-get install -y python3-pip awscli
```

The agent can create and edit this file itself — it takes effect on next restart.

### Dockerfile (recommended for known deps)

For permanent dependencies, add them to the agent's `Dockerfile.agent`:

```dockerfile
RUN apt-get update && apt-get install -y python3-pip awscli && rm -rf /var/lib/apt/lists/*
```

This is the cleanest option for tools that are always needed. The agent can suggest this to the operator.

## Git Sync

Agents commit and push to `origin` as part of their normal operation (defined in their kernel — see AGENTS.md). In Docker, set `GIT_REMOTE_URL` to configure the remote automatically on first run. The entrypoint checks if `origin` is already configured in the volume's git repo — if not, it adds it using the provided URL. The agent's own "commit and push" behavior then works out of the box.

### SSH deploy key (recommended)

Generate a key per agent, add it to the repo with write access, and bake it into the agent image:

```bash
# Generate key (one per agent)
mkdir -p deploy-keys
ssh-keygen -t ed25519 -f ./deploy-keys/my-agent -N "" -C "my-agent-deploy"

# Add to repo with write access (requires gh CLI)
gh repo deploy-key add ./deploy-keys/my-agent.pub \
  --repo yourorg/my-agent-state --title "my-agent-deploy" --allow-write
```

Add the COPY line to your agent's Dockerfile:

```dockerfile
COPY ./deploy-keys/my-agent /run/secrets/deploy_key
```

And set the remote URL in docker-compose:

```yaml
environment:
  - GIT_REMOTE_URL=git@github.com:yourorg/my-agent-state.git
```

The entrypoint copies the key to `/root/.ssh/`, sets permissions, and adds GitHub/GitLab/Bitbucket to `known_hosts` automatically. Each agent gets its own key with access only to its own state repo.

**Note:** the key ends up in the image layer. For private images that stay in your registry, this is fine. If you need to avoid that, mount the key as a volume instead: `./deploy-keys/my-agent:/run/secrets/deploy_key:ro`.

### HTTPS token URL (alternative)

No key files needed — embed a token directly in the URL:

```yaml
environment:
  - GIT_REMOTE_URL=https://x-access-token:ghp_xxx@github.com/yourorg/my-agent-state.git
```

| Provider | URL format |
|----------|-----------|
| GitHub (PAT) | `https://x-access-token:ghp_xxx@github.com/org/repo.git` |
| GitHub (fine-grained) | `https://x-access-token:github_pat_xxx@github.com/org/repo.git` |
| GitLab (deploy token) | `https://deploy:gldt-xxx@gitlab.com/org/repo.git` |
| Bitbucket (app password) | `https://user:app-password@bitbucket.org/org/repo.git` |

### What happens

- **First run (empty volume):** volume is seeded, git is initialized, remote is added, agent starts pushing
- **Subsequent runs:** volume already has git + remote, entrypoint skips setup
- **No `GIT_REMOTE_URL`:** no remote is configured, agent commits locally only (volume is still the source of truth)

### Multiple agents

Each agent gets its own repo and its own deploy key (baked into each agent's Dockerfile):

```yaml
services:
  sentinel:
    environment:
      - GIT_REMOTE_URL=git@github.com:org/sentinel-state.git
  oms-dev:
    environment:
      - GIT_REMOTE_URL=git@github.com:org/oms-dev-state.git
```

### Restoring from git

To restore an agent from its git repo into a fresh volume:

```bash
docker compose down -v                    # remove old volume
docker compose up -d                      # creates fresh volume, seeds, adds remote
docker exec kern-my-agent bash -c "cd /agent && git pull origin main"
```

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
