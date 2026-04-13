# Docker

Run a kern agent as a Docker container. All state persists in a mounted volume.

## Quick start

```bash
docker run -d \
  -v kern-data:/home/kern/agent \
  -p 4100:4100 \
  -e OPENROUTER_API_KEY=sk-or-... \
  ghcr.io/oguzbilgic/kern-ai
```

This starts an agent with default settings. The agent scaffolds itself on first run if no config exists.

## Environment variables

| Variable | Required | Default |
|----------|----------|---------|
| `OPENROUTER_API_KEY` | Yes (or provider-specific key) | — |
| `KERN_NAME` | No | `agent` (directory basename) |
| `KERN_MODEL` | No | `anthropic/claude-opus-4.6` |
| `KERN_PROVIDER` | No | `openrouter` |
| `KERN_PORT` | No | `4100` |
| `TELEGRAM_BOT_TOKEN` | No | — |
| `SLACK_BOT_TOKEN` | No | — |
| `SLACK_APP_TOKEN` | No | — |

For other providers, pass the matching API key:

```bash
# Anthropic direct
-e KERN_PROVIDER=anthropic -e ANTHROPIC_API_KEY=sk-ant-...

# OpenAI
-e KERN_PROVIDER=openai -e OPENAI_API_KEY=sk-...

# Ollama
-e KERN_PROVIDER=ollama -e OLLAMA_BASE_URL=http://host:11434
```

## Volumes

The agent stores all state in its working directory. Mount a volume to persist it across container restarts.

**Agent only** — mounts just the agent directory:
```bash
-v kern-data:/home/kern/agent
```

**Full home** — preserves global kern config, SSH keys, and any other user-level state:
```bash
-v kern-data:/home/kern
```

## Connecting

Once running, connect to the agent from the web UI:

1. Open the kern web UI
2. Click "Add agent"
3. Enter `http://<host>:4100`
4. Enter the agent's auth token (found in `.kern/.env` inside the volume)

## Building locally

```bash
docker build -t kern-ai .
docker run -d -v kern-data:/home/kern/agent -p 4100:4100 -e OPENROUTER_API_KEY=sk-or-... kern-ai
```
