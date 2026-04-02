# Memory

kern agents remember things between sessions. Memory is plain text files in a git repo — portable, readable, and version-controlled.

## How it works

Agents have three layers of memory:

1. **Knowledge** (`knowledge/`) — facts about how things are right now. Mutable. The agent updates these as things change.
2. **Notes** (`notes/`) — daily logs of what happened, what was decided, and what's still open. Append-only. One file per day.
3. **Recall** — semantic search over all past conversations. Even after messages leave the context window, the agent can find them with the `recall` tool.

## Auto-injected context

The runtime injects memory into the system prompt automatically. The agent boots aware of recent context without needing to read files:

- **KNOWLEDGE.md** — the index of all knowledge files (what state exists)
- **Recent notes summary** — an LLM-generated summary of the previous 5 daily notes
- **Latest daily note** — the most recent file from `notes/`, full content

The agent still reads specific `knowledge/` and `notes/` files when it needs detail beyond what's injected.

## Notes summary

The previous 5 daily notes are summarized into a short context block and cached in `.kern/notes-context.json`. The summary regenerates when the latest note filename changes (typically once per day, when the agent creates a new daily note).

Summary generation uses the same model as the agent. It runs synchronously on cache miss — the first message of a new day pays a small latency cost, every subsequent message reads from cache.

## Heartbeat

The runtime sends a `[heartbeat]` message periodically (default every 60 minutes, configurable via `heartbeatInterval`). The agent uses this to:

1. Save recent conversations to today's daily note
2. Check knowledge files for staleness and update them
3. Message the operator if something needs attention

This is how memory stays current during long sessions.

## Context window

kern uses a sliding window to manage context size. `maxContextTokens` (default 50000) sets the budget. When messages exceed this, the oldest are trimmed from the front. Full history is preserved in session JSONL files — nothing is lost.

Tool results can be large (command output, file contents, web pages). `maxToolResultChars` (default 20000) truncates oversized results in context while keeping the full output in session storage and the recall index.

## Recall

Past conversations are indexed with embeddings and stored in a local vector database (`.kern/recall.db`). The agent can search old conversations with the `recall` tool, even months later.

With `autoRecall` enabled, relevant old context is automatically injected before each turn — no tool call needed. See [Tools](/docs/tools#recall) for details.

## What gets persisted

| What | Where | Committed to git |
|------|-------|:---:|
| Knowledge files | `knowledge/` | ✓ |
| Daily notes | `notes/` | ✓ |
| KNOWLEDGE.md index | `KNOWLEDGE.md` | ✓ |
| Session messages | `.kern/sessions/` | ✗ |
| Recall database | `.kern/recall.db` | ✗ |
| Notes summary cache | `.kern/notes-context.json` | ✗ |
| API usage stats | `.kern/usage.json` | ✗ |

The committed files are the agent's portable memory — clone the repo and the agent picks up where it left off. Session files and recall databases are local caches that rebuild automatically.
