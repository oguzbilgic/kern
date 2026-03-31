#!/usr/bin/env node

/**
 * kern web — serves the web UI, provides agent discovery, and proxies to agents.
 *
 * Routes:
 *   GET  /                              → web UI (index.html)
 *   GET  /api/agents                    → list of registered agents
 *   GET  /api/agents/:name/events       → SSE proxy to agent
 *   POST /api/agents/:name/message      → proxy to agent
 *   GET  /api/agents/:name/status       → proxy to agent
 *   GET  /api/agents/:name/history      → proxy to agent
 *   GET  /api/agents/:name/health       → proxy to agent
 *   GET  /manifest.json                 → PWA manifest
 *   GET  /sw.js                         → service worker
 *   GET  /icon.svg                      → app icon
 */

import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "http";
import { readFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { homedir } from "os";
import { isProcessRunning, type AgentEntry } from "./registry.js";
import { loadGlobalConfig } from "./global-config.js";

const KERN_DIR = join(homedir(), ".kern");
const AGENTS_FILE = join(KERN_DIR, "agents.json");

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
  process.stderr.write(`${ts} [web] ${msg}\n`);
}

const staticFiles: Record<string, { file: string; contentType: string }> = {
  "/manifest.json": { file: "manifest.json", contentType: "application/manifest+json" },
  "/sw.js": { file: "sw.js", contentType: "application/javascript" },
  "/icon.svg": { file: "icon.svg", contentType: "image/svg+xml" },
};

/** Proxy a request to an agent's HTTP server, injecting its auth token */
function proxyToAgent(req: IncomingMessage, res: ServerResponse, agent: AgentEntry, targetPath: string) {
  const proxyReq = httpRequest(
    {
      hostname: "127.0.0.1",
      port: agent.port!,
      path: targetPath,
      method: req.method,
      headers: {
        ...req.headers,
        host: `127.0.0.1:${agent.port}`,
        authorization: agent.token ? `Bearer ${agent.token}` : "",
      },
    },
    (proxyRes) => {
      // Copy status + headers from agent response
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      // Pipe the response — works for SSE streams and regular responses
      proxyRes.pipe(res);
    },
  );

  proxyReq.on("error", (err) => {
    log(`proxy error for ${agent.name}: ${err.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "agent unreachable" }));
    }
  });

  // Pipe request body (for POST /message)
  req.pipe(proxyReq);
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const rawUrl = req.url || "/";
  const url = rawUrl.split("?")[0];

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
  if (url === "/" && req.method === "GET") {
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

  // Static PWA files
  if (req.method === "GET" && staticFiles[url]) {
    const { file, contentType } = staticFiles[url];
    const filePath = join(import.meta.dirname, "..", "templates", "web", file);
    if (existsSync(filePath)) {
      const content = await readFile(filePath, "utf-8");
      res.writeHead(200, { "Content-Type": contentType });
      res.end(content);
    } else {
      res.writeHead(404);
      res.end();
    }
    return;
  }

  // Agent list API — returns agents (no port/token — proxy handles auth)
  if (url === "/api/agents" && req.method === "GET") {
    const agents = await loadAgents();
    const result = agents.map((a) => ({
      name: a.name,
      running: !!(a.pid && isProcessRunning(a.pid)),
    }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
    return;
  }

  // Agent proxy — /api/agents/:name/:endpoint
  const proxyMatch = url.match(/^\/api\/agents\/([^/]+)\/(.+)$/);
  if (proxyMatch) {
    const [, agentName, endpoint] = proxyMatch;
    const agents = await loadAgents();
    const agent = agents.find((a) => a.name === agentName);

    if (!agent || !agent.port || !agent.pid || !isProcessRunning(agent.pid)) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "agent not found or not running" }));
      return;
    }

    // Build target URL — preserve query string
    const queryString = rawUrl.includes("?") ? rawUrl.slice(rawUrl.indexOf("?")) : "";
    const targetPath = `/${endpoint}${queryString}`;

    proxyToAgent(req, res, agent, targetPath);
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

async function start() {
  const config = await loadGlobalConfig();
  server.listen(config.web_port, config.web_host, () => {
    log(`listening on ${config.web_host}:${config.web_port}`);
  });
}

start();
