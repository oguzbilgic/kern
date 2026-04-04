# Memory

kern agents remember things between sessions. Memory is plain text files in a git repo — portable, readable, and version-controlled.

## How it works

Agents have four layers of memory:

1. **Knowledge** (`knowledge/`) — facts about how things are right now. Mutable. The agent updates these as things change.
2. **Notes** (`notes/`) — daily logs of what happened, what was decided, and what's still open. Append-only. One file per day.
3. **Recall** — semantic search over all past conversations. Even after messages leave the context window, the agent can find them with the `recall` tool.
4. **Segments** — automatic hierarchical summaries of conversation history. Messages are grouped into semantic segments, summarized, and rolled up into a multi-level tree. Compressed history is injected into the context window when old messages are trimmed.

## Auto-injected context

The runtime injects memory into the system prompt automatically. The agent boots aware of recent context without needing to read files:

- **KNOWLEDGE.md** — the index of all knowledge files (what state exists)
- **Recent notes summary** — an LLM-generated summary of the previous 5 daily notes
- **Latest daily note** — the most recent file from `notes/`, full content
- **Conversation summary** — compressed hierarchical summaries of trimmed conversation history

Each section of the system prompt is wrapped in an XML tag for clear identification:

| Tag | Content |
|-----|---------|
| `<document path="...">` | Loaded files (AGENTS.md, IDENTITY.md, KERN.md, KNOWLEDGE.md, latest daily note) |
| `<notes_summary>` | LLM-generated summary of previous 5 daily notes |
| `<tools>` | Available tools and descriptions |
| `<conversation_summary>` | Compressed history with nested `<summary>` blocks (only when messages have been trimmed) |

The system prompt is reloaded on every message, so changes to notes and knowledge are picked up immediately.

The agent still reads specific `knowledge/` and `notes/` files when it needs detail beyond what's injected.

## Notes summary

The previous 5 daily notes are summarized into a short context block and cached in the memory database (`.kern/recall.db`). The summary regenerates when the latest note filename changes (typically once per day, when the agent creates a new daily note).

Summary generation uses the same model as the agent. On cache miss (new day), the stale summary is served immediately and regeneration runs in the background — the first message of the day is never blocked. The fresh summary is picked up on the next message.

## Heartbeat

The runtime sends a `[heartbeat]` message periodically (default every 60 minutes, configurable via `heartbeatInterval`). The agent uses this to:

1. Save recent conversations to today's daily note
2. Check knowledge files for staleness and update them
3. Message the operator if something needs attention

This is how memory stays current during long sessions.

## Context window

kern uses a sliding window to manage context size. `maxContextTokens` (default 50000) sets the budget. When messages exceed this, the oldest are trimmed from the front. Full history is preserved in session JSONL files — nothing is lost.

Tool results can be large (command output, file contents, web pages). `maxToolResultChars` (default 20000) truncates oversized results in context while keeping the full output in session storage and the recall index.

## Segments and conversation summary

When messages are trimmed from the context window, the agent loses direct access to that conversation history. Segments solve this by injecting compressed summaries of the trimmed region.

**How it works:**

1. **Segmentation** — messages are grouped into semantic segments (L0) based on embedding similarity. Topic shifts create segment boundaries.
2. **Summarization** — each segment is summarized by an LLM (~10-20:1 compression ratio).
3. **Rollup** — every 10 L0 segments are summarized into an L1 parent. 10 L1s → L2, etc. This builds a hierarchical tree.
4. **Injection** — when messages are trimmed, `composeHistory` fills a token budget (`historyBudget`, default 20% of context) with summaries from the tree. Highest-level summaries cover old history cheaply, recent segments near the trim boundary are expanded to lower (more detailed) levels.

The result is injected as a `<conversation_summary>` block in the system prompt, containing `<summary>` entries for each segment:

```xml
<conversation_summary>
<summary>
level: L1
messages: 0-853

...compressed summary text...
</summary>

<summary>
level: L0
messages: 20766-20793
first: 2026-04-03T06:39:26.634Z
last: 2026-04-03T06:44:25.437Z

...detailed summary text...
</summary>
</conversation_summary>
```

Old conversations are represented at decreasing resolution, recent history at full detail.

The agent can drill deeper into any segment using the `recall` tool with message range parameters.

**Segmentation thresholds:**
- New segments are created incrementally when 10+ unsegmented messages AND 10k+ unsegmented tokens accumulate.
- Segments target ~15k tokens with a minimum of 5k tokens and 10 messages.

## Recall

Past conversations are indexed with embeddings and stored in a local vector database (`.kern/recall.db`). The agent can search old conversations with the `recall` tool, even months later.

With `autoRecall` enabled, relevant old context is automatically injected before each turn — no tool call needed. See [Tools](/docs/tools#recall) for details.

## Memory database

All non-git memory is stored in a single SQLite database (`.kern/recall.db`). This includes conversation indexes, embeddings, and cached summaries. The database is always created on startup — summaries work even with `recall: false`.

The database is safe to delete — it rebuilds from session JSONL files on next start. Summaries regenerate on the next cache miss.

## What gets persisted

| What | Where | Committed to git |
|------|-------|:---:|
| Knowledge files | `knowledge/` | ✓ |
| Daily notes | `notes/` | ✓ |
| KNOWLEDGE.md index | `KNOWLEDGE.md` | ✓ |
| Session messages | `.kern/sessions/` | ✗ |
| Memory database | `.kern/recall.db` | ✗ |
| API usage stats | `.kern/usage.json` | ✗ |

The committed files are the agent's portable memory — clone the repo and the agent picks up where it left off. Session files and the memory database are local caches that rebuild automatically.
