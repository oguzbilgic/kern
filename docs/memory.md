# Memory

kern agents remember things between sessions through plain text files in a git repo.

## Knowledge

`knowledge/` — mutable facts about how things are right now. The agent updates these as reality changes. Each file covers a topic (a machine, a service, a network). `KNOWLEDGE.md` at the repo root is the index — it lists what files exist and what they cover.

## Notes

`notes/` — daily logs of what happened, decisions made, and open items. One file per day named `YYYY-MM-DD.md`. Notes are historical records — the agent never modifies a previous day's file. Only files matching the date pattern are recognized — other files in `notes/` are ignored.

Two things are injected into the system prompt automatically on every message:

- **Latest daily note** — the most recent file from `notes/`, included in full. This gives the agent immediate access to today's (or the last active day's) context without reading any files.
- **Rolling notes summary** — an LLM-generated summary of the previous 5 daily notes, providing a compressed window of recent history beyond just today.

Together these mean the agent boots with awareness of what happened recently — no warmup, no manual file reads needed.

### Notes summary

The rolling summary is cached in the memory database. It regenerates when the latest note filename changes (once per day). On cache miss, the stale summary is served immediately while regeneration runs in the background — the first message of the day is never blocked.

## Heartbeat

The runtime sends a `[heartbeat]` message periodically (default every 60 minutes, configurable via `heartbeatInterval`). The agent uses this to:

1. Save recent conversations to today's daily note
2. Check knowledge files for staleness and update them
3. Message the operator if something needs attention

This keeps memory current during long sessions.

## What gets committed

| What | Where | In git |
|------|-------|:------:|
| Knowledge files | `knowledge/` | ✓ |
| Daily notes | `notes/` | ✓ |
| Knowledge index | `KNOWLEDGE.md` | ✓ |
| Agent behavior | `AGENTS.md` | ✓ |
| Agent identity | `IDENTITY.md` | ✓ |
| User registry | `USERS.md` | ✓ |

These are the agent's portable memory. Clone the repo and the agent picks up where it left off.

See [Context](context.md) for how memory is injected into the prompt.
