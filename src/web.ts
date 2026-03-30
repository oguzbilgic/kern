#!/usr/bin/env node

/**
 * kern web — serves the web UI and provides agent discovery.
 *
 * Routes:
 *   GET  /              → web UI (index.html)
 *   GET  /api/agents    → list of registered agents with ports + tokens
 *   GET  /manifest.json → PWA manifest
 *   GET  /sw.js         → service worker
 *   GET  /icon.svg      → app icon
 */

import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "http";
import { readFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { homedir } from "os";
import { isProcessRunning, type AgentEntry } from "./registry.js";
import { loadGlobalConfig } from "./global-config.js";
import { config as loadDotenv } from "dotenv";

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

// Load an agent's auth token from its .kern/.env file
function loadAgentToken(agentPath: string): string | null {
  const envPath = join(agentPath, ".kern", ".env");
  if (!existsSync(envPath)) return null;
  try {
    const parsed = loadDotenv({ path: envPath });
    return parsed.parsed?.KERN_AUTH_TOKEN || null;
  } catch {
    return null;
  }
}

// Find agent by name and return connection info
async function resolveAgent(name: string): Promise<{ port: number } | null> {
  const agents = await loadAgents();
  const agent = agents.find((a) => a.name === name);
  if (!agent || !agent.port || !agent.pid || !isProcessRunning(agent.pid)) return null;
  return { port: agent.port };
}

// Proxy an HTTP request to an agent — forwards client auth as-is
function proxyRequest(agentPort: number, path: string, req: IncomingMessage, res: ServerResponse) {
  const headers: Record<string, string> = {};
  // Forward client's auth to the agent
  if (req.headers["authorization"]) headers["Authorization"] = req.headers["authorization"];
  if (req.headers["content-type"]) headers["Content-Type"] = req.headers["content-type"];
  // Pass token query param through for SSE (EventSource can't set headers)
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
    // For SSE, pipe the stream directly
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
  });

  proxyReq.on("error", (e) => {
    log(`proxy error: ${e.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
    }
    res.end(JSON.stringify({ error: "agent unavailable" }));
  });

  // Pipe request body for POST
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

  // Agent list API — returns agents with connection info
  if (url === "/api/agents" && req.method === "GET") {
    const agents = await loadAgents();
    // Only expose tokens on localhost — remote clients (via proxy/ngrok) must enter them manually
    const forwarded = req.headers["x-forwarded-for"] || req.headers["x-forwarded-host"];
    const remoteAddr = req.socket.remoteAddress || "";
    const isLocal = !forwarded && (remoteAddr === "127.0.0.1" || remoteAddr === "::1" || remoteAddr === "::ffff:127.0.0.1");
    const result = agents.map((a) => ({
      name: a.name,
      port: a.port || null,
      token: isLocal ? (a.token || loadAgentToken(a.path) || null) : undefined,
      hasToken: !!(a.token || loadAgentToken(a.path)),
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
    const agentPath = proxyMatch[2] || "/";
    const agent = await resolveAgent(agentName);
    if (!agent) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `agent '${agentName}' not found or not running` }));
      return;
    }
    proxyRequest(agent.port, agentPath, req, res);
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
