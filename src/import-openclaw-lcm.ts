import Database from "better-sqlite3";
import { join } from "path";
import { existsSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { findAgent, loadRegistry, readAgentInfo } from "./registry.js";

interface LcmConversation {
  conversation_id: number;
  session_key: string | null;
  session_id: string | null;
  title: string | null;
  msgCount: number;
  firstSeen: string | null;
  lastSeen: string | null;
}

interface LcmRow {
  seq: number;
  role: string;
  message_content: string | null;
  ordinal: number | null;
  part_type: string | null;
  text_content: string | null;
  tool_call_id: string | null;
  tool_name: string | null;
  tool_input: string | null;
  tool_output: string | null;
  tool_status: string | null;
  is_ignored: number | null;
  is_synthetic: number | null;
}

function openLcmDb(path: string): Database.Database {
  if (!existsSync(path)) {
    console.error(`LCM database not found: ${path}`);
    process.exit(1);
  }
  const db = new Database(path, { readonly: true });
  try {
    db.prepare("SELECT 1 FROM message_parts LIMIT 1").get();
  } catch {
    console.error(`Not a valid OpenClaw LCM database: ${path}`);
    console.error("(missing message_parts table — wrong file?)");
    db.close();
    process.exit(1);
  }
  return db;
}

function listConversations(db: Database.Database): LcmConversation[] {
  const rows = db.prepare(`
    SELECT
      c.conversation_id,
      c.session_key,
      c.session_id,
      c.title,
      (SELECT COUNT(*) FROM messages WHERE conversation_id = c.conversation_id) AS msgCount,
      (SELECT MIN(created_at) FROM messages WHERE conversation_id = c.conversation_id) AS firstSeen,
      (SELECT MAX(created_at) FROM messages WHERE conversation_id = c.conversation_id) AS lastSeen
    FROM conversations c
    ORDER BY msgCount DESC
  `).all() as LcmConversation[];
  return rows;
}

function convLabel(c: LcmConversation): string {
  return c.session_key ?? c.session_id ?? c.title ?? `conv-${c.conversation_id}`;
}

function printConversationTable(convs: LcmConversation[]): void {
  if (convs.length === 0) {
    console.log("  (no conversations)");
    return;
  }
  const idW = Math.max(2, ...convs.map((c) => String(c.conversation_id).length));
  const keyW = Math.max(3, ...convs.map((c) => convLabel(c).length));
  const countW = Math.max(5, ...convs.map((c) => String(c.msgCount).length));
  console.log(
    "  " +
      "ID".padStart(idW) +
      "  " +
      "KEY".padEnd(keyW) +
      "  " +
      "MSGS".padStart(countW) +
      "  RANGE"
  );
  for (const c of convs) {
    const range =
      c.firstSeen && c.lastSeen
        ? `${c.firstSeen.slice(0, 10)} .. ${c.lastSeen.slice(0, 10)}`
        : "-";
    console.log(
      "  " +
        String(c.conversation_id).padStart(idW) +
        "  " +
        convLabel(c).padEnd(keyW) +
        "  " +
        String(c.msgCount).padStart(countW) +
        "  " +
        range
    );
  }
}

function pickDefaultConversation(convs: LcmConversation[]): LcmConversation | null {
  // Prefer *:main:main keys (primary agent sessions), ignore sub-agent spawns.
  const mains = convs.filter((c) => {
    const k = c.session_key ?? "";
    return /:main:main$/.test(k) || /^agent:main/.test(k);
  });
  if (mains.length === 1) return mains[0];
  if (mains.length > 1) {
    // Pick the one with the most messages.
    return mains.reduce((a, b) => (a.msgCount >= b.msgCount ? a : b));
  }
  // Fall back to overall largest if exactly one conversation has most messages and others are small.
  if (convs.length === 1) return convs[0];
  const sorted = [...convs].sort((a, b) => b.msgCount - a.msgCount);
  if (sorted.length >= 2 && sorted[0].msgCount >= sorted[1].msgCount * 10) return sorted[0];
  return null;
}

interface ConvertResult {
  messages: any[];
  stats: {
    textParts: number;
    toolCalls: number;
    toolResults: number;
    fallbackContent: number;
    droppedReasoning: number;
    droppedCompaction: number;
    droppedSystem: number;
    droppedSynthetic: number;
    droppedIgnored: number;
    droppedOrphans: number;
    droppedOther: { [partType: string]: number };
  };
}

function convertConversation(db: Database.Database, conversationId: number): ConvertResult {
  const rows = db.prepare(`
    SELECT
      m.seq            AS seq,
      m.role           AS role,
      m.content        AS message_content,
      mp.ordinal       AS ordinal,
      mp.part_type     AS part_type,
      mp.text_content  AS text_content,
      mp.tool_call_id  AS tool_call_id,
      mp.tool_name     AS tool_name,
      mp.tool_input    AS tool_input,
      mp.tool_output   AS tool_output,
      mp.tool_status   AS tool_status,
      mp.is_ignored    AS is_ignored,
      mp.is_synthetic  AS is_synthetic
    FROM messages m
    LEFT JOIN message_parts mp ON mp.message_id = m.message_id
    WHERE m.conversation_id = ?
    ORDER BY m.seq ASC, mp.ordinal ASC
  `).all(conversationId) as LcmRow[];

  const stats: ConvertResult["stats"] = {
    textParts: 0,
    toolCalls: 0,
    toolResults: 0,
    fallbackContent: 0,
    droppedReasoning: 0,
    droppedCompaction: 0,
    droppedSystem: 0,
    droppedSynthetic: 0,
    droppedIgnored: 0,
    droppedOrphans: 0,
    droppedOther: {},
  };

  // Group rows by seq (one message per seq). `message_content` comes from the
  // messages table and is the flat-text fallback when a message has no parts
  // (pre-parts-table era — first ~month of Lyra's history).
  type Grouped = { seq: number; role: string; content: string | null; parts: LcmRow[] };
  const groups = new Map<number, Grouped>();
  for (const r of rows) {
    let g = groups.get(r.seq);
    if (!g) {
      g = { seq: r.seq, role: r.role, content: r.message_content, parts: [] };
      groups.set(r.seq, g);
    }
    if (r.part_type) g.parts.push(r);
  }

  const kernMessages: any[] = [];
  for (const g of [...groups.values()].sort((a, b) => a.seq - b.seq)) {
    if (g.role === "system") {
      stats.droppedSystem++;
      continue;
    }

    const textParts: string[] = [];
    const toolCalls: any[] = [];
    const toolResults: any[] = [];

    // Fallback: no parts → use flat message.content as a single text block.
    // (Older messages before message_parts existed.)
    if (g.parts.length === 0) {
      if (g.content && g.content.trim()) {
        textParts.push(g.content);
        stats.fallbackContent++;
      }
    }

    for (const p of g.parts) {
      if (p.is_ignored) {
        stats.droppedIgnored++;
        continue;
      }
      if (p.is_synthetic) {
        stats.droppedSynthetic++;
        continue;
      }

      const t = p.part_type;
      if (t === "text") {
        // Tool-role + text part with tool_call_id = tool result (OpenClaw stores
        // results this way, not as part_type='tool').
        if (g.role === "tool" && p.tool_call_id) {
          toolResults.push({
            type: "tool-result",
            toolCallId: p.tool_call_id,
            toolName: p.tool_name || "unknown",
            output: { type: "text", value: p.text_content ?? "" },
          });
          stats.toolResults++;
        } else if (p.text_content && p.text_content.trim()) {
          textParts.push(p.text_content);
          stats.textParts++;
        }
      } else if (t === "reasoning") {
        stats.droppedReasoning++;
      } else if (t === "compaction") {
        stats.droppedCompaction++;
      } else if (t === "tool") {
        if (g.role === "assistant") {
          // Outgoing tool call.
          if (p.tool_call_id && p.tool_name) {
            let input: any = {};
            if (p.tool_input) {
              try {
                input = JSON.parse(p.tool_input);
              } catch {
                input = { raw: p.tool_input };
              }
            }
            toolCalls.push({
              type: "tool-call",
              toolCallId: p.tool_call_id,
              toolName: p.tool_name,
              input,
            });
            stats.toolCalls++;
          }
        } else if (g.role === "tool") {
          // Tool result.
          if (p.tool_call_id) {
            toolResults.push({
              type: "tool-result",
              toolCallId: p.tool_call_id,
              toolName: p.tool_name || "unknown",
              output: { type: "text", value: p.tool_output ?? p.text_content ?? "" },
            });
            stats.toolResults++;
          } else if (p.text_content) {
            // Legacy / synthetic tool output without an ID — skip (would be orphan).
            stats.droppedOrphans++;
          }
        }
      } else if (t) {
        stats.droppedOther[t] = (stats.droppedOther[t] ?? 0) + 1;
      }
    }

    if (g.role === "user") {
      const text = textParts.join("\n").trim();
      if (text) {
        kernMessages.push({ role: "user", content: text });
      }
    } else if (g.role === "assistant") {
      if (textParts.length > 0 && toolCalls.length > 0) {
        const content: any[] = [];
        for (const t of textParts) content.push({ type: "text", text: t });
        content.push(...toolCalls);
        kernMessages.push({ role: "assistant", content });
      } else if (toolCalls.length > 0) {
        kernMessages.push({ role: "assistant", content: toolCalls });
      } else if (textParts.length > 0) {
        kernMessages.push({ role: "assistant", content: textParts.join("\n") });
      }
      // Empty assistant messages (no text, no tools) are dropped silently.
    } else if (g.role === "tool") {
      if (toolResults.length > 0) {
        kernMessages.push({ role: "tool", content: toolResults });
      } else if (textParts.length > 0) {
        // Tool row with fallback content (no parts). We have no tool_call_id to
        // pair it with an assistant tool-call, so emit it as an assistant text
        // block labeled as a tool output. Preserves content without orphaning.
        kernMessages.push({
          role: "assistant",
          content: `[tool output]\n${textParts.join("\n")}`,
        });
      }
    }
  }

  // Post-process: drop orphan tool-calls (assistant with tool-call not followed by tool)
  // and dedup adjacent user messages. Mirrors src/import.ts cleaned() logic.
  const cleaned: any[] = [];
  for (let i = 0; i < kernMessages.length; i++) {
    const m = kernMessages[i];
    const next = kernMessages[i + 1];

    if (m.role === "assistant" && Array.isArray(m.content)) {
      const hasToolCall = m.content.some((p: any) => p.type === "tool-call");
      if (hasToolCall && (!next || next.role !== "tool")) {
        stats.droppedOrphans++;
        continue;
      }
    }

    if (m.role === "tool") {
      // Accept if any of the last K messages in `cleaned` was an assistant
      // with tool-calls. Multiple tool rows can follow one assistant turn
      // (multi-tool-call in a single message), so a strict "prev" check is
      // too tight.
      let ok = false;
      for (let j = cleaned.length - 1; j >= Math.max(0, cleaned.length - 6); j--) {
        const q = cleaned[j];
        if (q.role === "assistant" && Array.isArray(q.content) && q.content.some((p: any) => p.type === "tool-call")) {
          ok = true;
          break;
        }
        if (q.role === "user") break; // user message resets the turn
      }
      if (!ok) {
        stats.droppedOrphans++;
        continue;
      }
    }

    if (m.role === "user" && next?.role === "user") {
      // Collapse duplicate adjacent user messages (rare but seen in LCM after compactions).
      stats.droppedOrphans++;
      continue;
    }

    cleaned.push(m);
  }

  return { messages: cleaned, stats };
}

function getFlag(args: string[], name: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === `--${name}` && i + 1 < args.length) return args[i + 1];
    if (args[i].startsWith(`--${name}=`)) return args[i].slice(name.length + 3);
  }
  return undefined;
}

function hasFlag(args: string[], name: string): boolean {
  return args.some((a) => a === `--${name}` || a.startsWith(`--${name}=`));
}

export async function importOpenClawLcm(args: string[]): Promise<void> {
  const dbPath = args.find((a) => !a.startsWith("--"));
  if (!dbPath) {
    console.error("Usage: kern import openclaw-lcm <lcm.db> [--agent <name>] [--conversation <id>] [--list]");
    process.exit(1);
  }

  const db = openLcmDb(dbPath);
  const convs = listConversations(db);

  // --- --list short-circuit ---
  if (hasFlag(args, "list")) {
    console.log(`  LCM database: ${dbPath}`);
    console.log(`  Conversations: ${convs.length}`);
    console.log("");
    printConversationTable(convs);
    console.log("");
    db.close();
    process.exit(0);
  }

  if (convs.length === 0) {
    console.error("No conversations found in LCM database.");
    db.close();
    process.exit(1);
  }

  // --- Pick conversation ---
  let conversation: LcmConversation | null = null;
  const convArg = getFlag(args, "conversation");

  if (convArg) {
    const wantId = Number(convArg);
    const match = Number.isFinite(wantId)
      ? convs.find((c) => c.conversation_id === wantId)
      : convs.find((c) => c.session_key === convArg || c.session_id === convArg);
    if (!match) {
      console.error(`Conversation not found: ${convArg}`);
      console.error("Use --list to see available conversations.");
      db.close();
      process.exit(1);
    }
    conversation = match;
  } else {
    conversation = pickDefaultConversation(convs);
    if (!conversation) {
      console.error("Multiple conversations found and no clear main. Pass --conversation <id> (or --list to see them).");
      db.close();
      process.exit(1);
    }
  }
  console.log(`  Conversation: ${convLabel(conversation)} (id=${conversation.conversation_id}, ${conversation.msgCount} msgs)`);

  // --- Pick destination agent ---
  let agentPath: string;
  let agentName: string;
  const agentArg = getFlag(args, "agent");

  if (agentArg) {
    const agent = findAgent(agentArg);
    if (!agent) {
      console.error(`Agent not found: ${agentArg}`);
      db.close();
      process.exit(1);
    }
    agentPath = agent.path;
    agentName = agent.name;
  } else {
    const paths = await loadRegistry();
    const agents = paths.map((p) => readAgentInfo(p)).filter(Boolean) as { name: string; path: string }[];
    if (agents.length === 0) {
      console.error("No agents registered. Run 'kern init <name>' first, or pass --agent <name>.");
      db.close();
      process.exit(1);
    }
    const { select } = await import("@inquirer/prompts");
    const chosen = await select({
      message: "Import into which agent",
      choices: agents.map((a) => ({ name: `${a.name} (${a.path})`, value: a.name })),
    });
    const agent = agents.find((a) => a.name === chosen)!;
    agentPath = agent.path;
    agentName = agent.name;
  }
  console.log(`  Agent: ${agentName} (${agentPath})`);

  // --- Convert ---
  const { messages: kernMessages, stats } = convertConversation(db, conversation.conversation_id);
  db.close();

  console.log("");
  console.log(`  Text parts:       ${stats.textParts}`);
  console.log(`  Tool calls:       ${stats.toolCalls}`);
  console.log(`  Tool results:     ${stats.toolResults}`);
  if (stats.fallbackContent) {
    console.log(`  Flat fallback:    ${stats.fallbackContent}  (pre-parts-table messages)`);
  }
  console.log(`  Dropped:`);
  console.log(`    reasoning:      ${stats.droppedReasoning}`);
  console.log(`    compaction:     ${stats.droppedCompaction}`);
  console.log(`    system rows:    ${stats.droppedSystem}`);
  console.log(`    synthetic:      ${stats.droppedSynthetic}`);
  console.log(`    ignored:        ${stats.droppedIgnored}`);
  console.log(`    orphans:        ${stats.droppedOrphans}`);
  for (const [t, n] of Object.entries(stats.droppedOther)) {
    console.log(`    ${t.padEnd(14)}  ${n}`);
  }
  console.log(`  Messages:         ${kernMessages.length}`);

  // --- Write ---
  const sessionsDir = join(agentPath, ".kern", "sessions");
  await mkdir(sessionsDir, { recursive: true });

  const sessionUuid = crypto.randomUUID();
  const now = new Date().toISOString();
  const jsonlPath = join(sessionsDir, `${sessionUuid}.jsonl`);

  const meta = JSON.stringify({
    id: sessionUuid,
    createdAt: now,
    updatedAt: now,
    importedFrom: "openclaw-lcm",
    originalConversationId: conversation.conversation_id,
    originalConversationKey: conversation.session_key ?? conversation.session_id ?? null,
    sourceDb: dbPath,
  });

  const lines = [meta, ...kernMessages.map((m: any) => JSON.stringify(m))];
  await writeFile(jsonlPath, lines.join("\n") + "\n");

  console.log("");
  console.log(`  Imported to ${jsonlPath}`);
  console.log(`  ${kernMessages.length} messages`);
  console.log("");
}
