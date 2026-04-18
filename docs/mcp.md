# MCP — Model Context Protocol

Kern connects to [Model Context Protocol](https://modelcontextprotocol.io/) servers and exposes their tools to the agent. Each server is defined in the agent's config and connected at startup.

## Configuring servers

Add `mcpServers` to `.kern/config.json`:

```json
{
  "mcpServers": {
    "github": {
      "transport": "http",
      "url": "https://api.githubcopilot.com/mcp",
      "headers": {
        "Authorization": "Bearer ${GITHUB_TOKEN}"
      }
    },
    "filesystem": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
    },
    "zapier": {
      "transport": "sse",
      "url": "https://actions.zapier.com/mcp/..."
    }
  }
}
```

Each server needs a `transport` field:

| Transport | Fields | Notes |
|---|---|---|
| `http` | `url`, optional `headers` | Recommended for remote servers |
| `sse` | `url`, optional `headers` | Alternative HTTP transport |
| `stdio` | `command`, optional `args`, optional `env` | Spawns a local process |

## Environment variable substitution

`${VAR}` references in any string field (url, headers, command, args, env) are resolved from `.kern/.env` at startup. Names follow shell convention (letters, digits, underscore; first char not a digit; case-sensitive). Missing vars are left as literal `${VAR}` and logged as a warning — the server will return its real auth error when it fails.

Use this for tokens and secrets. Don't commit resolved values to config.

## Tool naming

MCP tools are namespaced with the server name: `<server>__<tool>`. So a `create_issue` tool from a server named `github` appears to the agent as `github__create_issue`. This prevents collisions when multiple servers expose tools with the same name.

## Failure handling

- Servers connect in parallel at startup. One server failing doesn't block others or the agent.
- Failed connections log an error and are dropped. Fix the config and restart to retry.
- The `/status` endpoint reports `mcp: <connected>/<configured> server(s), <M> tool(s)`. If `<connected>` is less than `<configured>`, check logs for the connection error.

## Scope

Kern's MCP integration is intentionally minimal:

- **Tools only** — resources, prompts, and elicitation are not exposed.
- **No OAuth flow** — authorize tokens out-of-band and pass via headers or env.
- **All-or-nothing** — all tools from a connected server are available to the agent. There's no per-tool filter yet.

File an issue if you need something beyond this.
