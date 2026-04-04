# Memory

kern agents remember things between sessions through plain text files in a git repo.

## Knowledge

`knowledge/` — mutable facts about how things are right now. The agent updates these as reality changes. Each file covers a topic (a machine, a service, a network). `KNOWLEDGE.md` at the repo root is the index — it lists what files exist and what they cover.

## Notes

`notes/` — daily logs of what happened, decisions made, and open items. Append-only, one file per day. Notes are historical records — the agent never modifies a previous day's file.

### Notes summary

The previous 5 daily notes are summarized into a short context block, cached in the memory database. The summary regenerates when the latest note filename changes (once per day). On cache miss, the stale summary is served immediately while regeneration runs in the background — the first message of the day is never blocked.

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

See [Sessions](sessions.md) for conversation storage and [Context](context.md) for how memory is injected into the prompt.
