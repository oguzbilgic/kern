#!/bin/sh
set -e

# Seed the agent volume from baked-in defaults if present and volume is empty
if [ -d /agent-seed ] && [ ! -f /agent/AGENTS.md ]; then
  echo "[kern] seeding agent volume from /agent-seed..."
  cp -r /agent-seed/. /agent/
  # Initialize git if not already a repo
  if [ ! -d /agent/.git ]; then
    cd /agent && git init && git add -A && git commit -m "initial agent state" 2>/dev/null || true
  fi
fi

exec "$@"
