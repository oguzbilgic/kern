#!/usr/bin/env node

/**
 * kern hub — lightweight reverse proxy that serves the web UI on a single
 * origin and proxies requests to individual agents.
 *
 * Routes:
 *   GET  /                     → web UI
 *   GET  /api/agents           → list of running agents
 *   *    /agent/<name>/<path>  → proxy to agent's port
 *
 * The hub reads ~/.kern/agents.json to discover agents and their ports.
 * No config needed — just `kern hub` or `node hub.js`.
 */

import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "http";
import { readFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { homedir } from "os";

const HUB_PORT = parseInt(process.env.KERN_HUB_PORT || "9000", 10);
const HUB_HOST = process.env.KERN_HUB_HOST || "0.0.0.0";
const AGENTS_FILE = join(homedir(), ".kern", "agents.json");

interface AgentEntry {
  name: string;
  path: string;
  pid?: number | null;
  port?: number | null;
}

async function loadAgents(): Promise<AgentEntry[]> {
  if (!existsSync(AGENTS_FILE)) return [];
  try {
    return JSON.parse(await readFile(AGENTS_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function log(msg: string) {
  const ts = new Date().toISOString();
  process.stderr.write(`${ts} [hub] ${msg}\n`);
}

// Proxy a request to an agent
function proxy(
  req: IncomingMessage,
  res: ServerResponse,
  targetPort: number,
  targetPath: string
) {
  const proxyReq = httpRequest(
    {
      hostname: "127.0.0.1",
      port: targetPort,
      path: targetPath,
      method: req.method,
      headers: {
        ...req.headers,
        host: `127.0.0.1:${targetPort}`,
      },
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res, { end: true });
    }
  );

  proxyReq.on("error", (err) => {
    log(`proxy error: ${err.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "agent unreachable" }));
    }
  });

  req.pipe(proxyReq, { end: true });
}

const server = createServer(async (req, res) => {
  const url = req.url || "/";
  const path = url.split("?")[0];

  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  // Web UI
  if (path === "/" && req.method === "GET") {
    const webUiPath = join(import.meta.dirname, "..", "templates", "web", "index.html");
    if (existsSync(webUiPath)) {
      const html = await readFile(webUiPath, "utf-8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
    } else {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("Web UI not found. Check kern installation.");
    }
    return;
  }

  // Agent list API — returns running agents for the switcher
  if (path === "/api/agents" && req.method === "GET") {
    const agents = await loadAgents();
    const running = agents
      .filter((a) => a.port && a.pid)
      .map((a) => ({ name: a.name, port: a.port }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(running));
    return;
  }

  // Proxy: /agent/<name>/... → agent's port
  const proxyMatch = path.match(/^\/agent\/([^/]+)(\/.*)?$/);
  if (proxyMatch) {
    const agentName = proxyMatch[1];
    const agentPath = (proxyMatch[2] || "/") + (url.includes("?") ? "?" + url.split("?")[1] : "");

    const agents = await loadAgents();
    const agent = agents.find((a) => a.name === agentName);

    if (!agent || !agent.port) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `agent '${agentName}' not found or not running` }));
      return;
    }

    proxy(req, res, agent.port, agentPath);
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(HUB_PORT, HUB_HOST, () => {
  log(`listening on ${HUB_HOST}:${HUB_PORT}`);
  log(`web UI: http://localhost:${HUB_PORT}/`);
  log(`agents proxied at: /agent/<name>/...`);
});
