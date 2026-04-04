# Sessions

Each agent has one continuous session — a single conversation history shared across all interfaces.

## Storage

Messages are stored in two places:

- **SQLite database** (`.kern/recall.db`, `messages` table) — written synchronously on every message. ACID transactions, crash-safe, no corruption risk from partial writes.
- **JSONL file** (`.kern/sessions/<id>.jsonl`) — also written on every message. Human-readable, one JSON object per line. First line is session metadata, rest are messages.

Both are always written. The database is the durable copy. JSONL is the current read path (loaded on startup) and serves as a portable backup.

## Session lifecycle

- On first start, a new session is created with a random UUID.
- On subsequent starts, the most recent session is loaded from JSONL.
- Messages accumulate indefinitely — there's no session rotation or expiry.
- The full history is always preserved even when the [context window](context.md) trims old messages.

## Crash recovery

If the process dies mid-turn:
- Messages already appended to the DB and JSONL are safe.
- An incomplete assistant turn (tool call without result) is detected on load and a synthetic "[interrupted]" message is appended so the model doesn't re-execute lost tool calls.

If JSONL is corrupted, the session can be rebuilt from the database. Recovery scripts are available for this.

## What's stored per message

| Field | Description |
|-------|-------------|
| `session_id` | UUID of the session |
| `msg_index` | Sequential position (0-based) |
| `role` | `user`, `assistant`, or `tool` |
| `content` | Message text or JSON array (tool calls/results) |
| `timestamp` | ISO 8601, extracted from message metadata when present |

## Local files

| Path | Description | In git |
|------|-------------|:------:|
| `.kern/sessions/*.jsonl` | Session JSONL files | ✗ |
| `.kern/recall.db` | Memory database (messages + indexes) | ✗ |
| `.kern/usage.json` | Cumulative API token usage | ✗ |
| `.kern/logs/kern.log` | Daemon logs | ✗ |
| `.kern/pairing.json` | User pairing state | ✗ |
