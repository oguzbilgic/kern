# Tools

kern provides 10 built-in tools. Availability depends on `toolScope` in config.

## bash

Run shell commands. Full access to the system.

```
bash({ command: "ls -la", timeout: 120000 })
```

- `command` — shell command to execute
- `timeout` — optional, milliseconds (default 120000)

Scope: `full` only.

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
