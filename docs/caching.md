# Prompt Caching

How kern minimizes API costs by keeping the conversation prefix stable and cacheable.

## How it works

Large language model APIs cache repeated input prefixes server-side. If the first N tokens of a request match a previous request exactly, the provider serves them from cache at a fraction of the cost (~10% for Anthropic).

kern's prompt is large — system prompt, injected documents, conversation summary, and raw messages can exceed 100k tokens. Without caching, every turn pays full price for the entire prompt. With caching, only new messages at the end cost full price.

## Provider behavior

| Provider | Caching | Mechanism |
|----------|---------|-----------|
| Anthropic (via OpenRouter) | Explicit | Requires `cache_control: ephemeral` markers on message parts |
| OpenAI / GPT | Automatic | Server-side prefix caching, no SDK changes needed |
| DeepSeek | Automatic | Same as OpenAI |
| Google | Not supported | No caching currently |

kern uses `@openrouter/ai-sdk-provider` which supports Anthropic's `cacheControl` natively. For OpenAI models, caching happens transparently.

## Cache breakpoints

kern places up to three cache breakpoints in the prompt to maximize prefix reuse:

### BP1 — System prompt

Placed on the system message. Caches:
- All injected documents (AGENTS.md, IDENTITY.md, KERN.md, KNOWLEDGE.md, USERS.md)
- Latest daily note and notes summary
- Tool definitions
- Conversation summary (`<conversation_summary>`)

This is the largest cached block (~75k tokens). It stays stable as long as the conversation summary doesn't change.

### BP2 — Stable message prefix

Placed at a fixed message index snapped to every 20-message boundary (e.g., message 60, 80, 100). This caches the prefix of the raw message window. It moves forward only every ~20 turns, keeping the cached prefix byte-identical in between.

### BP3 — Turn breakpoint

Placed on the last user message. This caches everything up to the current turn, so multi-step tool calls within one turn reuse the entire prefix at 99%+ hit rate.

## Trim snapping

The message window start (where old messages are cut) must be stable for caching to work. If it drifts by even one message, the entire conversation prefix changes and the cache busts.

### Strategy

1. **Find snap target** — the nearest L0 segment `msg_end` at or beyond the token-budget trim point. This is the last message fully covered by a segment summary. Falls back to rounding up to the nearest multiple of 20 if no L0 edge is nearby.

2. **Walk back to safe boundary** — from the snap target, walk backward to the nearest `user` message. This ensures the raw message window never starts mid-turn, which would orphan `tool_result` blocks without their matching `tool_use`.

3. **Apply snap** — trim the extra messages. A small overlap with the summarized region is acceptable.

This keeps the window start locked for many turns, only shifting when a new L0 segment completes or the token budget pushes past the next snap point.

### Why user messages?

SDK tool structure requires `tool_use` and `tool_result` blocks to be paired. Trimming between them causes API errors:

```
unexpected tool_use_id found in tool_result blocks
No tool call found for function call output with call_id ...
```

User messages are always turn boundaries — safe to start the window there.

## Summary stability

The conversation summary (`<conversation_summary>`) is the largest part of the cached system prompt. It changes when:

- A new L0 segment is created (every ~100 messages)
- Segments are rolled up (L0→L1, L1→L2)
- Segment summaries are regenerated

When the summary changes, BP1 busts and a full cache write occurs. Between summary changes, the summary is byte-identical every turn.

Breadth-first expansion (L2→L1 before L1→L0) ensures the summary covers the full history evenly rather than expanding only the most recent segments.

## Cache hit rates

| Scenario | Hit rate | Notes |
|----------|----------|-------|
| Mid-turn (tool calls) | ~99% | BP3 caches prefix, only new tool results are uncached |
| Between turns | ~99% | Trim snap + BP2 keep prefix stable |
| After new segment | 0% (one turn) | Summary changes bust BP1; recovers next turn |

## Cost impact

With a ~100k token prompt:
- ~75k tokens are summary (cached at 10% cost after first turn)
- ~25k tokens are raw messages (partially cached via BP2/BP3)
- Effective cost reduction: ~80-90% on input tokens for most turns

## Configuration

| Config | Default | Effect on caching |
|--------|---------|-------------------|
| `maxContextTokens` | 100000 | Larger = more messages cached |
| `summaryBudget` | 0.75 | Higher = more tokens in stable cached summary |

## Monitoring

Cache stats are logged per turn:

```
cache: 246904 read, 726 written (100% hit rate, 247890 total input)
```

Cumulative stats are tracked in `.kern/usage.json` and shown in `/status`:

```
cache: 1.2M read, 12K written
```
