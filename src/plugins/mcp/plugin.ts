import type { KernPlugin, PluginContext } from "../types.js";
import type { McpServerConfig } from "../../config.js";
import { createMCPClient } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import { substituteEnvDeep } from "../../util.js";
import { log } from "../../log.js";

type MCPClient = Awaited<ReturnType<typeof createMCPClient>>;

/** One connected MCP server. */
interface ActiveServer {
  name: string;
  client: MCPClient;
  toolCount: number;
}

/** Connected servers for the lifetime of this plugin. */
const active: ActiveServer[] = [];

/**
 * Merged tools from all servers, namespaced as `<server>__<tool>`.
 * Populated during onStartup; read by the plugin manager's collectTools()
 * which runs after onStartup awaits complete, so a plain object is fine.
 */
const mergedTools: Record<string, any> = {};

/**
 * Build a transport from one server's config. Env vars already substituted.
 */
function buildTransport(name: string, cfg: McpServerConfig) {
  if (cfg.transport === "http" || cfg.transport === "sse") {
    return {
      type: cfg.transport,
      url: cfg.url,
      ...(cfg.headers ? { headers: cfg.headers } : {}),
    } as const;
  }
  if (cfg.transport === "stdio") {
    return new Experimental_StdioMCPTransport({
      command: cfg.command,
      args: cfg.args ?? [],
      env: cfg.env,
    });
  }
  throw new Error(`unknown MCP transport for server "${name}"`);
}

/**
 * Connect to one server, fetch its tools, and prefix them with the server name.
 */
async function connectServer(name: string, cfg: McpServerConfig): Promise<void> {
  // Warn (don't fail) on unresolved ${VAR} references; let the server return
  // the real auth error so the user sees what's missing.
  const resolved = substituteEnvDeep(cfg, (missing) => {
    log.warn("mcp", `server "${name}": ${missing} not set in env`);
  });

  const transport = buildTransport(name, resolved);
  const client = await createMCPClient({ transport });
  const serverTools = await client.tools();

  let count = 0;
  for (const [toolName, tool] of Object.entries(serverTools)) {
    mergedTools[`${name}__${toolName}`] = tool;
    count++;
  }

  active.push({ name, client, toolCount: count });
  log("mcp", `connected "${name}" — ${count} tool(s)`);
}

export const mcpPlugin: KernPlugin = {
  name: "mcp",
  tools: mergedTools,

  async onStartup(ctx: PluginContext) {
    const servers = ctx.config.mcpServers;
    if (!servers || Object.keys(servers).length === 0) return;

    // Connect to all servers in parallel; failures don't block the agent
    // or other servers — they just mean those tools aren't available.
    await Promise.all(
      Object.entries(servers).map(([name, cfg]) =>
        connectServer(name, cfg).catch((err: any) => {
          log.error("mcp", `failed to connect "${name}": ${err.message}`);
        }),
      ),
    );
  },

  async onShutdown() {
    await Promise.all(
      active.map((s) =>
        s.client.close().catch((err: any) => {
          log.warn("mcp", `close error for "${s.name}": ${err.message}`);
        }),
      ),
    );
    active.length = 0;
    for (const k of Object.keys(mergedTools)) delete mergedTools[k];
  },

  onStatus() {
    if (active.length === 0) return {};
    const total = active.reduce((sum, s) => sum + s.toolCount, 0);
    return {
      mcp: `${active.length} server(s), ${total} tool(s)`,
    };
  },
};
