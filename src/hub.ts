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

const PORT = parseInt(process.argv[2] || "4000", 10);

interface Agent {
  name: string;
  publicKey: string;
  socket: WebSocket;
}

// Pending challenges: socket → nonce
const challenges = new Map<WebSocket, string>();
// Authenticated agents: name → Agent
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

      // If name already taken by different key, reject
      const existing = agents.get(name);
      if (existing && existing.publicKey !== publicKey) {
        ws.send(JSON.stringify({ type: "error", error: "name taken" }));
        ws.close();
        return;
      }

      // If same agent reconnecting, close old socket
      if (existing) {
        try { existing.socket.close(); } catch {}
      }

      agents.set(name, { name, publicKey, socket: ws });
      ws.send(JSON.stringify({ type: "registered", name }));
      log(`${name} registered (${agents.size} agents online)`);
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
