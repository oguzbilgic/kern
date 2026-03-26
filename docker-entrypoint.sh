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

exec "$@"
