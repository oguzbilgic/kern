# Tools

kern provides built-in tools. Availability depends on `toolScope` in config.

## bash

Run shell commands on Unix/Linux. Full access to the system.

```
bash({ command: "ls -la", timeout: 120000 })
```

- `command` — shell command to execute
- `timeout` — optional, milliseconds (default 120000)

Scope: `full` only. Unix/Linux only — on Windows, `pwsh` is provided instead.

## pwsh

Run PowerShell commands on Windows. Full access to the system.

```
pwsh({ command: "Get-Process", timeout: 120000 })
```

- `command` — PowerShell command to execute
- `timeout` — optional, milliseconds (default 120000)

Scope: `full` only. Windows only — on Unix/Linux, `bash` is provided instead. Detects `pwsh` (PS 7+) with fallback to `powershell` (5.1).

## read

Read a file or list a directory.

```
read({ path: "IDENTITY.md", offset: 1, limit: 2000 })
```

- `path` — absolute or relative path
- `offset` — line number to start from (1-indexed, default 1)
- `limit` — max lines to return (default 2000)

Returns file contents with line numbers, or directory entries.

## write

Create or overwrite a file.

```
write({ path: "notes/2026-03-24.md", content: "# Today\n..." })
```

Creates parent directories as needed.

## edit

Exact string replacement in a file.

```
edit({ path: "config.json", oldString: "opus-4", newString: "opus-4.6", replaceAll: false })
```

- `oldString` must match exactly
- `replaceAll` — replace all occurrences (default false)

## glob

Find files by pattern.

```
glob({ pattern: "**/*.md", path: "/root/atlas" })
```

## grep

Search file contents with regex.

```
grep({ pattern: "TODO", path: ".", include: "*.md" })
```

## webfetch

Fetch a URL and return the response body.

```
webfetch({ url: "https://example.com", timeout: 30000 })
```

Truncates responses over 50000 chars.

## kern

Manage the runtime.

```
kern({ action: "status" })     // runtime info, context size, API usage, queue, interface status
kern({ action: "config" })     // show .kern/config.json
kern({ action: "env" })        // show env var names (masked values)
kern({ action: "pair", code: "KERN-XXXX" })  // approve a pairing code
kern({ action: "users" })      // list paired and pending users
kern({ action: "logs" })       // recent warn+ logs (default: 50 lines)
kern({ action: "logs", level: "error" })           // errors only
kern({ action: "logs", level: "info", lines: 20 }) // last 20 info+ lines
```

## message

Send a message to a user on any channel.

```
message({ userId: "12345", interface: "telegram", text: "Hello!" })
```

- `userId` — from USERS.md or pairing data
- `interface` — `telegram` or `slack`
- Looks up chatId from pairing data
- Broadcasts outgoing event to TUI

## recall

Search long-term memory for old conversations outside the current context window. Two modes:

### Search mode

```
recall({ query: "pfSense firewall rules", limit: 5, after: "2026-03-25", before: "2026-03-28" })
```

- `query` — semantic search query
- `limit` — max results (default 5)
- `after` — only results after this date (ISO 8601 or YYYY-MM-DD)
- `before` — only results before this date

Returns matching conversation chunks with distance score, timestamp, session ID, and message range.

### Load mode

```
recall({ sessionId: "96fbe7c5-...", messageStart: 100, messageEnd: 110 })
```

- `sessionId` — session to load from
- `messageStart` / `messageEnd` — message index range

Returns raw messages for a specific range — use after search to get full context around a hit.

### How it works

On startup, kern indexes the current session's messages into a local sqlite-vec database (`.kern/recall.db`). Indexing runs in the background — the agent is available immediately while the index builds. Raw messages are stored in sqlite alongside embedded chunks, so retrieval doesn't need to read session files.

Messages are chunked by turn (user→assistant pairs), embedded via `text-embedding-3-small`, and stored as vectors. After each turn, new messages are incrementally indexed — only new lines are parsed.

Search uses cosine similarity (KNN) to find the most relevant past conversation chunks.

Check indexing status via `kern({ action: "status" })` — the `recall` field shows message/chunk counts and whether the index is still building.

### Requirements

Requires an API key for the configured provider (used for embeddings). Uses `text-embedding-3-small` (1536 dimensions).

### Auto-recall

When `"autoRecall": true` is set in config, kern automatically injects relevant old context before each turn:

- Embeds the user's message and searches the recall index (top 3 results, distance < 0.95)
- Skips chunks already visible in the current context window
- Injects a `<recall>` block at the top of the context (ephemeral — not persisted to session)
- Capped at ~2000 tokens to avoid bloating context

The web UI shows a collapsible `📎 N memories recalled` block with the search query and chunk details.

Auto-recall only fires when messages have been trimmed from context (long sessions). Short sessions with everything in context don't trigger it.

### Opt-out

Set `"recall": false` in `.kern/config.json` to disable recall entirely.

Set `"autoRecall": false` (or omit it) to disable auto-injection while keeping the recall search tool available.
