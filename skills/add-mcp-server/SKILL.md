---
name: add-mcp-server
description: Add a Model Context Protocol (MCP) server to extend your toolbox with external tools
---

# Add MCP Server

MCP (Model Context Protocol) lets you connect to external tool servers — GitHub, filesystem, databases, SaaS APIs, etc. — and call their tools like native kern tools. Use this skill when the operator asks you to add a capability that an MCP server provides, or when you need a tool kern doesn't ship.

## Decide: which server?

If the operator named a server ("add the GitHub MCP"), use that. Otherwise:

1. **Check the official list**: https://github.com/modelcontextprotocol/servers — official reference servers (filesystem, git, memory, fetch, etc.)
2. **Web search** for community servers: `websearch` for `"<capability> MCP server"`. Prefer well-maintained, popular ones.
3. **Vendor-hosted**: many SaaS vendors expose MCP endpoints (GitHub, Cloudflare, Sentry, etc.). Check their docs.

If nothing fits, tell the operator what you found and ask how to proceed.

## Decide: which transport?

- **`http`** — hosted endpoint (`https://...`). Best for SaaS / vendor MCPs.
- **`sse`** — legacy streaming variant of HTTP. Use if the server only documents SSE.
- **`stdio`** — local process. The server runs as a subprocess on your machine. Used for `npx`/`uvx` reference servers.

Rule of thumb: if the server has a URL, use `http`. If the install instructions say `npx @scope/server-name`, use `stdio`.

## Step 1: find the config values

You need, depending on transport:

| Transport | Required fields |
|---|---|
| `http` / `sse` | `url`, optional `headers` (for auth) |
| `stdio` | `command`, `args`, optional `env` |

Read the server's README. Find the example config. Note any required env vars (tokens, API keys, paths).

## Step 2: add secrets to `.kern/.env`

Never hardcode tokens. Add them to `.kern/.env`:

```bash
echo 'GITHUB_TOKEN=ghp_xxxxxxxxxxxx' >> .kern/.env
```

Use the exact variable name the server expects. Reference it in config as `${VAR_NAME}`.

## Step 3: add the server to `.kern/config.json`

Read the current config first so you don't clobber other fields. Then add or extend the `mcpServers` block.

### Hosted HTTP example (GitHub)

```json
{
  "mcpServers": {
    "github": {
      "transport": "http",
      "url": "https://api.githubcopilot.com/mcp",
      "headers": {
        "Authorization": "Bearer ${GITHUB_TOKEN}"
      }
    }
  }
}
```

### Local stdio example (filesystem)

```json
{
  "mcpServers": {
    "filesystem": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"]
    }
  }
}
```

### With env vars for stdio

```json
{
  "mcpServers": {
    "sentry": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@sentry/mcp-server"],
      "env": {
        "SENTRY_AUTH_TOKEN": "${SENTRY_TOKEN}"
      }
    }
  }
}
```

Multiple servers live side-by-side in the same `mcpServers` object. Server names are free-form but must be valid identifiers (letters, digits, underscore); they become the prefix for tool names.

## Step 4: restart

Config is read at startup. Ask the operator to `/restart`.

## Step 5: verify

After restart, check `/status` or the kern tool:

```
/status
```

Look for a line like `mcp: 1 server(s), 14 tool(s)`. If the count is 0, the server failed to connect — the reason is in the logs (`kern({ action: "logs", level: "warn" })`).

New tools appear in your toolbox as `<server>__<tool>` — e.g. `github__search_repositories`, `filesystem__read_file`. Call them the same way you'd call any other tool.

## Troubleshooting

**`mcp: 0 server(s)`**: server never connected. Check logs for the real error (bad URL, auth failure, npx not found, wrong env var name).

**`${VAR}` stays literal in logs**: the env var isn't in `.kern/.env` or the name doesn't match (env var names are case-sensitive). Check `.kern/.env`.

**Server connects but no tools appear**: server has zero tools (some MCP servers only expose resources or prompts, which kern doesn't use). Try a different server.

**`command not found` for stdio**: the command must be on the agent's PATH. `npx` works because Node is installed. For other runtimes (uvx, python, etc.), confirm they're available on the host.

**Tool name collisions**: two servers exposing the same tool name won't collide — they're namespaced by server. If you want shorter names, rename the server key.

## Reporting back

After verifying, tell the operator:
- Which server you added
- How many tools it exposes
- A sample tool name they can try

If it failed, report the exact error from the logs and what you tried.

## Reference

Full details: see `docs/mcp.md` in the kern repo.
