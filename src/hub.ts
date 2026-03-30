#!/usr/bin/env node

/**
 * kern hub — WebSocket relay for agent-to-agent communication.
 *
 * Agents connect, authenticate via challenge-response (Ed25519),
 * and send messages to each other. Hub is a dumb pipe.
 */

import { WebSocketServer, type WebSocket } from "ws";
import { randomBytes } from "crypto";
import { verify } from "./keys.js";
import { loadGlobalConfig } from "./global-config.js";

const config = await loadGlobalConfig();
const PORT = parseInt(process.argv[2] || String(config.hub_port), 10);

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

interface Agent {
  name: string;
  publicKey: string;
  socket: WebSocket;
}

interface RegisteredAgent {
  name: string;
  publicKey: string;
}

const HUB_DIR = join(homedir(), ".kern", "hub");
const REGISTRY_FILE = join(HUB_DIR, "agents.json");

// Load persistent registry
function loadRegistry(): RegisteredAgent[] {
  if (!existsSync(REGISTRY_FILE)) return [];
  try { return JSON.parse(readFileSync(REGISTRY_FILE, "utf-8")); } catch { return []; }
}

function saveRegistry(agents: RegisteredAgent[]) {
  mkdirSync(HUB_DIR, { recursive: true });
  writeFileSync(REGISTRY_FILE, JSON.stringify(agents, null, 2));
}

let registry = loadRegistry();

// Pending challenges: socket → nonce
const challenges = new Map<WebSocket, string>();
// Connected agents: name → Agent (online only)
const agents = new Map<string, Agent>();

function log(msg: string) {
  const ts = new Date().toISOString();
  process.stderr.write(`${ts} [hub] ${msg}\n`);
}

const wss = new WebSocketServer({ port: PORT });

wss.on("listening", () => {
  log(`listening on :${PORT}`);
});

wss.on("connection", (ws) => {
  // Send challenge
  const nonce = randomBytes(32).toString("hex");
  challenges.set(ws, nonce);
  ws.send(JSON.stringify({ type: "challenge", nonce }));

  ws.on("message", (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    // Auth response
    if (msg.type === "auth") {
      const nonce = challenges.get(ws);
      if (!nonce) {
        ws.send(JSON.stringify({ type: "error", error: "no pending challenge" }));
        return;
      }

      const { name, publicKey, signature } = msg;
      if (!name || !publicKey || !signature) {
        ws.send(JSON.stringify({ type: "error", error: "missing auth fields" }));
        return;
      }

      if (!verify(publicKey, nonce, signature)) {
        ws.send(JSON.stringify({ type: "error", error: "invalid signature" }));
        ws.close();
        return;
      }

      challenges.delete(ws);

      // Check persistent registry — if name exists with different key, reject
      const knownAgent = registry.find(a => a.name === name);
      if (knownAgent && knownAgent.publicKey !== publicKey) {
        ws.send(JSON.stringify({ type: "error", error: "name taken by different key" }));
        ws.close();
        return;
      }

      // Register if new
      if (!knownAgent) {
        registry.push({ name, publicKey });
        saveRegistry(registry);
        log(`${name} registered (new agent)`);
      }

      // If same agent reconnecting, close old socket
      const online = agents.get(name);
      if (online) {
        try { online.socket.close(); } catch {}
      }

      agents.set(name, { name, publicKey, socket: ws });
      ws.send(JSON.stringify({ type: "registered", name }));
      log(`${name} connected (${agents.size} agents online)`);
      return;
    }

    // Message relay — must be authenticated
    if (msg.type === "message") {
      const sender = findAgent(ws);
      if (!sender) {
        ws.send(JSON.stringify({ type: "error", error: "not authenticated" }));
        return;
      }

      const { to, text } = msg;
      if (!to || !text) {
        ws.send(JSON.stringify({ type: "error", error: "missing to/text" }));
        return;
      }

      const target = agents.get(to);
      if (!target) {
        ws.send(JSON.stringify({ type: "error", error: `agent '${to}' not found` }));
        return;
      }

      // Relay with sender info
      target.socket.send(JSON.stringify({
        type: "message",
        from: sender.name,
        text,
        timestamp: new Date().toISOString(),
      }));

      log(`${sender.name} → ${to}: ${text.slice(0, 80)}`);
      ws.send(JSON.stringify({ type: "delivered", to }));
      return;
    }
  });

  ws.on("close", () => {
    challenges.delete(ws);
    const agent = findAgent(ws);
    if (agent) {
      agents.delete(agent.name);
      log(`${agent.name} disconnected (${agents.size} agents online)`);
    }
  });
});

function findAgent(ws: WebSocket): Agent | undefined {
  for (const agent of agents.values()) {
    if (agent.socket === ws) return agent;
  }
  return undefined;
}
