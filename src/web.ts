#!/usr/bin/env node

/**
 * kern web — serves the web UI, agent discovery, and proxy.
 *
 * Routes:
 *   GET  /              → web UI (index.html)
 *   GET  /api/agents    → list of registered agents (name, running, proxy path)
 *   GET  /manifest.json → PWA manifest
 *   GET  /sw.js         → service worker
 *   GET  /icon.svg      → app icon
 *   *    /agent/:name/* → proxy to agent's localhost port (auth forwarded as-is)
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

// Find agent by name and return its port
async function resolveAgent(name: string): Promise<number | null> {
  const agents = await loadAgents();
  const agent = agents.find((a) => a.name === name);
  if (!agent || !agent.port || !agent.pid || !isProcessRunning(agent.pid)) return null;
  return agent.port;
}

// Proxy an HTTP request to an agent — fully transparent, forwards auth as-is
function proxyRequest(agentPort: number, path: string, req: IncomingMessage, res: ServerResponse) {
  const headers: Record<string, string> = {};
  if (req.headers["authorization"]) headers["Authorization"] = req.headers["authorization"];
  if (req.headers["content-type"]) headers["Content-Type"] = req.headers["content-type"];
  // Forward query params (needed for ?token= on SSE EventSource)
  const rawUrl = req.url || "";
  const queryIdx = rawUrl.indexOf("?");
  if (queryIdx !== -1) path += rawUrl.slice(queryIdx);

  const proxyReq = httpRequest({
    hostname: "127.0.0.1",
    port: agentPort,
    path,
    method: req.method,
    headers,
  }, (proxyRes) => {
    const ct = proxyRes.headers["content-type"] || "";
    const proxyHeaders: Record<string, string> = {
      "Content-Type": ct,
      "Access-Control-Allow-Origin": "*",
    };
    if (ct.includes("text/event-stream")) {
      proxyHeaders["Cache-Control"] = "no-cache";
      proxyHeaders["Connection"] = "keep-alive";
      proxyHeaders["X-Accel-Buffering"] = "no";
    }
    res.writeHead(proxyRes.statusCode || 200, proxyHeaders);
    proxyRes.pipe(res);

    // Clean up upstream connection when client disconnects
    res.on("close", () => proxyReq.destroy());
  });

  proxyReq.on("error", (e) => {
    log(`proxy error: ${e.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
    }
    res.end(JSON.stringify({ error: "agent unavailable" }));
  });

  req.pipe(proxyReq);
}

const staticFiles: Record<string, { file: string; contentType: string }> = {
  "/manifest.json": { file: "manifest.json", contentType: "application/manifest+json" },
  "/sw.js": { file: "sw.js", contentType: "application/javascript" },
  "/icon.svg": { file: "icon.svg", contentType: "image/svg+xml" },
};

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

  // Agent list API
  if (url === "/api/agents" && req.method === "GET") {
    const agents = await loadAgents();
    const result = agents.map((a) => ({
      name: a.name,
      port: a.port || null,
      token: a.token || null,
      running: !!(a.pid && isProcessRunning(a.pid)),
      proxy: a.port ? `/agent/${encodeURIComponent(a.name)}` : null,
    }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
    return;
  }

  // Agent proxy: /agent/:name/* → localhost:port/*
  const proxyMatch = url.match(/^\/agent\/([^/]+)(\/.*)?$/);
  if (proxyMatch && req.method) {
    const agentName = decodeURIComponent(proxyMatch[1]);
    const agentPort = await resolveAgent(agentName);
    if (!agentPort) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "agent not found or not running" }));
      return;
    }
    proxyRequest(agentPort, proxyMatch[2] || "/", req, res);
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
