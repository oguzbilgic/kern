#!/bin/sh
set -e

# Seed the agent volume from baked-in defaults if present and volume is empty
if [ -d /agent-seed ] && [ ! -f /agent/AGENTS.md ]; then
  echo "[kern] seeding agent volume from /agent-seed..."
  cp -r /agent-seed/. /agent/
  # Initialize git if not already a repo
  if [ ! -d /agent/.git ]; then
    cd /agent && git init \
      && git config user.email "kern@localhost" \
      && git config user.name "kern" \
      && git add -A \
      && git commit -m "initial agent state" 2>/dev/null || true
  fi
fi

# Configure SSH if a deploy key exists (baked in via Dockerfile.agent COPY)
if [ -f /run/secrets/deploy_key ]; then
  mkdir -p /root/.ssh
  cp /run/secrets/deploy_key /root/.ssh/id_ed25519
  chmod 600 /root/.ssh/id_ed25519
  # Add common git hosts to known_hosts
  ssh-keyscan -t ed25519 github.com gitlab.com bitbucket.org >> /root/.ssh/known_hosts 2>/dev/null
  echo "[kern] SSH deploy key configured"
fi

# Configure git remote if GIT_REMOTE_URL is set and origin doesn't exist yet.
# Works with both HTTPS token URLs and SSH URLs:
#   GIT_REMOTE_URL=https://x-access-token:ghp_xxx@github.com/org/repo.git
#   GIT_REMOTE_URL=git@github.com:org/repo.git
if [ -n "$GIT_REMOTE_URL" ] && [ -d /agent/.git ]; then
  cd /agent
  if ! git remote get-url origin >/dev/null 2>&1; then
    echo "[kern] adding git remote origin"
    git remote add origin "$GIT_REMOTE_URL"
  fi
fi

# Add agent's persistent local bin to PATH (for runtime-installed tools)
# Agent can install binaries to /agent/.local/bin/ and they survive restarts.
if [ -d /agent/.local/bin ]; then
  export PATH="/agent/.local/bin:$PATH"
fi

# Run agent init script if it exists (for runtime dependencies)
# Agent can create/edit .kern/init.sh to install packages on every start.
if [ -x /agent/.kern/init.sh ]; then
  echo "[kern] running .kern/init.sh"
  /agent/.kern/init.sh
fi

# Write Docker-specific instructions for the agent's system prompt.
# The runtime loads all .md files from .kern/context/ into the prompt.
mkdir -p /agent/.kern/context
cat > /agent/.kern/context/docker.md << 'DOCKER_CONTEXT'
### Docker environment
You are running inside a Docker container. Only `/agent` (this repo) is on a persistent volume — everything else is ephemeral and lost on restart.

#### Installing tools
System packages (`apt-get install`) do not survive container restarts. Use these options instead:

1. **Persistent binaries** — install standalone binaries to `/agent/.local/bin/`. This directory is on PATH and persists across restarts. Gitignored.
   ```bash
   mkdir -p /agent/.local/bin
   # download or build binary to /agent/.local/bin/
   ```

2. **Startup script** — create `.kern/init.sh` for packages that need `apt-get`. This runs on every container start before you. Gitignored. Make it executable.
   ```bash
   #!/bin/sh
   apt-get update && apt-get install -y python3-pip
   ```

3. **Ask your operator** — for permanent dependencies, suggest they add `RUN apt-get install ...` to the agent Dockerfile and rebuild.

Prefer option 1 when possible (no restart needed). Use option 2 for things that can't be installed to a custom path. Option 3 is best for tools that are always needed.
DOCKER_CONTEXT

exec "$@"
