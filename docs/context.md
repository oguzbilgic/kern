# Context

How kern builds the prompt the model sees on each turn.

## System prompt

Reloaded on every message. Composed from the agent's repo files and runtime state:

| Section | Tag | Source |
|---------|-----|--------|
| Agent behavior | `<document path="AGENTS.md">` | Repo file |
| Agent identity | `<document path="IDENTITY.md">` | Repo file |
| Runtime docs | `<document path="KERN.md">` | Template from kern |
| Knowledge index | `<document path="KNOWLEDGE.md">` | Repo file |
| Latest daily note | `<document path="notes/...">` | Most recent `notes/` file |
| Notes summary | `<notes_summary>` | LLM summary of previous 5 daily notes, cached in DB |
| Available tools | `<tools>` | Based on `toolScope` config |
| Conversation summary | `<conversation_summary>` | Compressed summaries from segments (only when messages are trimmed) |

Changes to notes or knowledge files are picked up immediately — no restart needed.

## Context window

`maxContextTokens` (default 50000) sets the token budget. When the full message history exceeds this, the oldest messages are trimmed from the front. Nothing is lost — full history stays in session JSONL files.

### Tool result truncation

Tool results (command output, file contents, web pages) can be large. `maxToolResultChars` (default 20000) truncates oversized results in context while keeping the full output in session storage and the recall index.

### Token budget allocation

The total budget is split between:

- **Conversation summary** — `summaryBudget` fraction (default 0.2 = 20%) for compressed conversation summaries from segments
- **Raw messages** — the remaining budget for actual conversation messages

## Conversation summary

When old messages are trimmed, the agent loses direct access to that history. Segments solve this by injecting compressed summaries of the trimmed region.

**Pipeline:**

1. **Segmentation** — messages are grouped into semantic segments (L0) based on embedding similarity. Topic shifts create boundaries. Runs incrementally after each turn.
2. **Summarization** — each segment is summarized by an LLM (~10-20:1 compression).
3. **Rollup** — every 10 L0 segments are rolled up into an L1 parent. 10 L1s → L2, etc. This builds a hierarchical tree.
4. **Injection** — `composeHistory` fills the summary budget with summaries from the tree. Old conversations use high-level summaries (cheap), recent conversation near the trim boundary expands to lower levels (more detail).

The result is a `<conversation_summary>` block in the system prompt:

```xml
<conversation_summary>
<summary>
level: L2
messages: 0-4500

...high-level summary of early conversation...
</summary>

<summary>
level: L0
messages: 20766-20793
first: 2026-04-03T06:39:26.634Z
last: 2026-04-03T06:44:25.437Z

...detailed recent summary...
</summary>
</conversation_summary>
```

**Requires:** `recall` enabled (uses embeddings for segmentation). Controlled by `summaryBudget` — set to `0` to disable.

**Segmentation thresholds:**
- Triggers when 10+ unsegmented messages AND 10k+ unsegmented tokens accumulate
- Targets ~15k tokens per segment, minimum 5k tokens and 10 messages

## Auto-recall

When `autoRecall: true`, the runtime automatically searches past conversations before each turn and injects relevant results as a `<recall>` block at the top of the message list. This is ephemeral — not persisted to the session.

Only fires when messages have been trimmed (long sessions). Capped at ~2000 tokens. See [Tools → recall](tools.md#recall) for the manual search tool.

## Inspection

The web UI includes a Memory inspector overlay with five tabs:

- **Sessions** — session list with message counts, durations, role breakdowns, and activity charts. Live session indicator. Click any session to expand.
- **Segments** — hierarchical segment tree (L0/L1/L2). Click any segment to see its markdown summary, token compression stats, and metadata. Filter by "All" or "In context". Collapsible rolled-up groups for child segments.
- **Notes** — notes summaries with regeneration. Rendered as markdown.
- **Recall** — stats (indexed messages, chunks, sessions, date range) and semantic search.
- **Context** — structured view of the full system prompt. Parses XML tags into collapsible colored sections with token cost bars. Shows real token breakdown (system + summary + messages).

### API endpoints

- `GET /context/system` — the full composed system prompt as text
- `GET /context/segments` — segment IDs and metadata currently injected by `composeHistory()`
- `GET /sessions` — session list with `currentSessionId` for live session identification
- `GET /recall/stats` — recall index stats (messages, chunks, sessions, date range)
