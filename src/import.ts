import Database from "better-sqlite3";
import { join } from "path";
import { existsSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { homedir } from "os";
import { findAgent } from "./registry.js";
import { log } from "./log.js";

interface OpenCodeMessage {
  id: string;
  session_id: string;
  time_created: number;
  data: string;
}

interface OpenCodePart {
  id: string;
  message_id: string;
  time_created: number;
  data: string;
}

export async function importOpenCode(agentName?: string): Promise<void> {
  if (!agentName) {
    console.error("Usage: kern import opencode <agent>");
    process.exit(1);
  }

  let agent = await findAgent(agentName);
  if (!agent) {
    // Try as a path
    const { resolve } = await import("path");
    const dir = resolve(agentName);
    if (existsSync(dir) && (existsSync(join(dir, ".kern")) || existsSync(join(dir, "AGENTS.md")))) {
      const { basename } = await import("path");
      agent = { name: basename(dir), path: dir, addedAt: new Date().toISOString() };
    } else {
      console.error(`Agent not found: ${agentName}`);
      process.exit(1);
    }
  }

  // Find OpenCode db
  const dbPath = join(homedir(), ".local", "share", "opencode", "opencode.db");
  if (!existsSync(dbPath)) {
    console.error(`OpenCode database not found at ${dbPath}`);
    process.exit(1);
  }

  const db = new Database(dbPath, { readonly: true });

  // Find project by worktree path
  const project = db.prepare("SELECT id FROM project WHERE worktree = ?").get(agent.path) as { id: string } | undefined;
  if (!project) {
    console.error(`No OpenCode project found for ${agent.path}`);
    db.close();
    process.exit(1);
  }

  // Get sessions
  const sessions = db.prepare(
    "SELECT id, title, time_created, time_updated FROM session WHERE project_id = ? ORDER BY time_updated DESC"
  ).all(project.id) as { id: string; title: string; time_created: number; time_updated: number }[];

  if (sessions.length === 0) {
    console.error("No sessions found.");
    db.close();
    process.exit(1);
  }

  // Pick most recent or let user choose
  let sessionId: string;
  if (sessions.length === 1) {
    sessionId = sessions[0].id;
    console.log(`  Session: ${sessions[0].title}`);
  } else {
    console.log(`\n  Found ${sessions.length} sessions:\n`);
    // Show top 5
    for (let i = 0; i < Math.min(5, sessions.length); i++) {
      const s = sessions[i];
      const date = new Date(s.time_updated).toISOString().slice(0, 10);
      console.log(`  ${i + 1}. ${s.title} (${date})`);
    }
    // Pick most recent by default
    sessionId = sessions[0].id;
    console.log(`\n  Importing most recent: ${sessions[0].title}`);
  }

  // Count messages
  const msgCount = db.prepare("SELECT COUNT(*) as count FROM message WHERE session_id = ?").get(sessionId) as { count: number };
  console.log(`  Messages: ${msgCount.count}`);

  // Read all messages with their parts
  const messages = db.prepare(
    "SELECT id, time_created, data FROM message WHERE session_id = ? ORDER BY time_created"
  ).all(sessionId) as OpenCodeMessage[];

  const getPartsStmt = db.prepare(
    "SELECT id, time_created, data FROM part WHERE message_id = ? ORDER BY time_created"
  );

  // Convert to kern ModelMessage format
  // Group parts per OpenCode message into proper ModelMessage structure
  const kernMessages: any[] = [];
  let converted = 0;
  let skipped = 0;

  for (const msg of messages) {
    const msgData = JSON.parse(msg.data);
    const parts = getPartsStmt.all(msg.id) as OpenCodePart[];
    const role = msgData.role;

    // Collect text and tool parts for this message
    const textParts: string[] = [];
    const toolCalls: any[] = [];
    const toolResults: any[] = [];

    for (const part of parts) {
      const partData = JSON.parse(part.data);

      if (partData.type === "text" && partData.text) {
        textParts.push(partData.text);
        converted++;
      } else if (partData.type === "tool" && partData.state) {
        if (partData.state.input) {
          toolCalls.push({
            type: "tool-call",
            toolCallId: partData.callID || `call_${converted}`,
            toolName: partData.tool,
            args: partData.state.input,
          });
          converted++;
        }
        if (partData.state.status === "completed" && partData.state.output !== undefined) {
          toolResults.push({
            type: "tool-result",
            toolCallId: partData.callID || `call_${converted}`,
            toolName: partData.tool,
            result: partData.state.output,
          });
          converted++;
        }
      } else {
        skipped++;
      }
    }

    // Build kern messages for this OpenCode message
    if (role === "user") {
      // User messages: just text
      const text = textParts.join("\n");
      if (text) {
        kernMessages.push({ role: "user", content: text });
      }
    } else if (role === "assistant") {
      // Assistant: combine text + tool calls into one message
      if (textParts.length > 0 && toolCalls.length > 0) {
        // Mixed: text + tool calls in one content array
        const content: any[] = [];
        for (const t of textParts) {
          content.push({ type: "text", text: t });
        }
        content.push(...toolCalls);
        kernMessages.push({ role: "assistant", content });
      } else if (toolCalls.length > 0) {
        // Tool calls only
        kernMessages.push({ role: "assistant", content: toolCalls });
      } else if (textParts.length > 0) {
        // Text only
        kernMessages.push({ role: "assistant", content: textParts.join("\n") });
      }

      // Tool results as separate tool messages (required by AI SDK)
      for (const tr of toolResults) {
        kernMessages.push({ role: "tool", content: [tr] });
      }
    }
  }

  db.close();

  console.log(`  Converted: ${converted} parts`);
  console.log(`  Skipped: ${skipped} parts (step markers, reasoning, etc.)`);

  // Write to kern session JSONL
  const sessionsDir = join(agent.path, ".kern", "sessions");
  await mkdir(sessionsDir, { recursive: true });

  const sessionUuid = crypto.randomUUID();
  const now = new Date().toISOString();
  const jsonlPath = join(sessionsDir, `${sessionUuid}.jsonl`);

  const meta = JSON.stringify({
    id: sessionUuid,
    createdAt: now,
    updatedAt: now,
    importedFrom: "opencode",
    originalSessionId: sessionId,
  });

  const lines = [meta, ...kernMessages.map((m) => JSON.stringify(m))];
  await writeFile(jsonlPath, lines.join("\n") + "\n");

  console.log(`\n  Imported to ${jsonlPath}`);
  console.log(`  Session ID: ${sessionUuid}`);
  console.log(`  ${kernMessages.length} messages`);
  console.log("");

  process.exit(0);
}
