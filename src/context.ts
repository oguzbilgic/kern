import type { ModelMessage, ToolResultPart } from "ai";
import { readFile, readdir } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { log } from "./log.js";
import { getToolsForScope, type KernConfig } from "./config.js";
import type { RecallIndex } from "./recall.js";

// Build the system prompt from agent markdown files + runtime info.
export async function loadSystemPrompt(agentDir: string, config: KernConfig): Promise<string> {
  const parts: string[] = [];

  // Load AGENTS.md (kernel)
  const agentsPath = join(agentDir, "AGENTS.md");
  if (existsSync(agentsPath)) {
    parts.push(await readFile(agentsPath, "utf-8"));
  }

  // Load IDENTITY.md
  const identityPath = join(agentDir, "IDENTITY.md");
  if (existsSync(identityPath)) {
    parts.push(await readFile(identityPath, "utf-8"));
  }

  // Load KERN.md (runtime context) — from agent dir first, fall back to kern package
  const kernMdAgent = join(agentDir, "KERN.md");
  const kernMdPackage = join(import.meta.dirname, "..", "templates", "KERN.md");
  if (existsSync(kernMdAgent)) {
    parts.push(await readFile(kernMdAgent, "utf-8"));
  } else if (existsSync(kernMdPackage)) {
    parts.push(await readFile(kernMdPackage, "utf-8"));
  }

  // Load KNOWLEDGE.md (memory index)
  const knowledgePath = join(agentDir, "KNOWLEDGE.md");
  if (existsSync(knowledgePath)) {
    parts.push(await readFile(knowledgePath, "utf-8"));
  }

  // Inject latest daily note from notes/ directory
  const notesDir = join(agentDir, "notes");
  if (existsSync(notesDir)) {
    try {
      const files = await readdir(notesDir);
      const mdFiles = files.filter(f => f.endsWith(".md")).sort();
      if (mdFiles.length > 0) {
        const latest = mdFiles[mdFiles.length - 1];
        const content = await readFile(join(notesDir, latest), "utf-8");
        if (content.trim()) {
          parts.push(`# Latest Daily Note\n\n${content.trim()}`);
        }
      }
    } catch (err: any) {
      log("context", `failed to read daily notes: ${err.message}`);
    }
  }

  // Inject live runtime info
  const tools = getToolsForScope(config.toolScope);
  const toolDescriptions: Record<string, string> = {
    bash: "run shell commands",
    read: "read files and directories",
    write: "create or overwrite files",
    edit: "find and replace in files",
    glob: "find files by pattern",
    grep: "search file contents",
    webfetch: "fetch URLs",
    kern: "manage your own runtime (status, config, env)",
    message: "send messages proactively",
    recall: "search long-term memory for old conversations outside current context",
  };
  const toolList = tools.map(t => `- **${t}**: ${toolDescriptions[t] || t}`).join("\n");

  parts.push(`### Your tools\n${toolList}`);

  if (parts.length === 0) {
    return "You are a helpful AI assistant.";
  }

  return parts.join("\n\n---\n\n");
}

// Token estimate: stringify everything, ~4 chars per token
function estimateTokens(messages: ModelMessage[]): number {
  let chars = 0;
  for (const msg of messages) {
    chars += JSON.stringify(msg).length;
  }
  return Math.ceil(chars / 4);
}

// Per-message token size cache
const msgSizeCache = new WeakMap<ModelMessage, number>();

function getMsgSize(msg: ModelMessage): number {
  let size = msgSizeCache.get(msg);
  if (size === undefined) {
    size = Math.ceil(JSON.stringify(msg).length / 4);
    msgSizeCache.set(msg, size);
  }
  return size;
}

// Truncate oversized tool results to keep context window usable.
// Full results remain in session JSONL (and recall index) — only the context copy is truncated.
function truncateLargeToolResults(messages: ModelMessage[], maxChars: number, tokenBudget: number = 0): { messages: ModelMessage[]; truncatedCount: number } {
  if (maxChars <= 0) return { messages, truncatedCount: 0 };

  // Only process messages within 2x the token budget from the end — older ones get trimmed anyway
  let startIndex = 0;
  if (tokenBudget > 0) {
    const tokenLimit = tokenBudget * 2; // 2x budget
    let tokens = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      tokens += getMsgSize(messages[i]);
      if (tokens > tokenLimit) { startIndex = i + 1; break; }
    }
  }

  let changed = false;
  let truncatedCount = 0;
  const result: ModelMessage[] = startIndex > 0 ? messages.slice(0, startIndex) : [];

  for (let idx = startIndex; idx < messages.length; idx++) {
    const msg = messages[idx];
    if (msg.role !== "tool" || !Array.isArray(msg.content)) {
      result.push(msg);
      continue;
    }

    let partChanged = false;
    const newParts: ToolResultPart[] = [];

    for (const part of msg.content as ToolResultPart[]) {
      if (part.type === "tool-result" && part.output && "value" in part.output) {
        const { value } = part.output;
        const valueStr = typeof value === "string" ? value : JSON.stringify(value);
        if (valueStr.length > maxChars) {
          const truncated = valueStr.slice(0, maxChars);
          const note = `\n\n[truncated from ${valueStr.length} to ${maxChars} chars — use recall tool to search full content]`;
          newParts.push({
            ...part,
            output: { type: "text", value: truncated + note },
          });
          partChanged = true;
          truncatedCount++;
          continue;
        }
      }
      newParts.push(part);
    }

    if (partChanged) {
      result.push({ ...msg, content: newParts } as ModelMessage);
      changed = true;
    } else {
      result.push(msg);
    }
  }

  return { messages: changed ? result : messages, truncatedCount };
}

function trimToTokenBudget(messages: ModelMessage[], maxTokens: number): ModelMessage[] {
  if (maxTokens <= 0) return messages;

  // Compute total using cached per-message sizes
  let total = 0;
  for (const msg of messages) {
    total += getMsgSize(msg);
  }
  if (total <= maxTokens) return messages;

  // Find cut point from the front
  let cutTotal = total;
  let cutIndex = 0;
  while (cutIndex < messages.length - 1 && cutTotal > maxTokens) {
    cutTotal -= getMsgSize(messages[cutIndex]);
    cutIndex++;
  }

  // Adjust: skip orphaned tool messages
  while (cutIndex < messages.length - 1 && messages[cutIndex].role === "tool") {
    cutIndex++;
  }
  // Ensure we start with a user message
  while (cutIndex < messages.length - 1 && messages[cutIndex].role !== "user") {
    cutIndex++;
  }

  return messages.slice(cutIndex);
}

export interface SessionStats {
  totalMessages: number;
  estimatedTokens: number;
  windowTokens: number;
  windowMessages: number;
  truncatedCount: number;
}

// Unified pipeline: truncate → trim → stats. Single call, all numbers out.
export function prepareContext(messages: ModelMessage[], config: KernConfig): { messages: ModelMessage[]; stats: SessionStats } {
  const totalTokens = estimateTokens(messages);
  const { messages: truncated, truncatedCount } = truncateLargeToolResults(messages, config.maxToolResultChars, config.maxContextTokens);
  const window = trimToTokenBudget(truncated, config.maxContextTokens);
  // Only count truncations that survived trimming
  // FRAGILE: matches suffix appended by truncateLargeToolResults — keep in sync
  const truncationSuffix = "use recall tool to search full content]";
  const trimmedTruncated = truncatedCount > 0
    ? window.reduce((n, msg) => {
        if (msg.role !== "tool" || !Array.isArray(msg.content)) return n;
        return n + (msg.content as ToolResultPart[]).filter(p =>
          p.type === "tool-result" && p.output?.type === "text" && p.output.value.endsWith(truncationSuffix)
        ).length;
      }, 0)
    : 0;
  return {
    messages: window,
    stats: {
      totalMessages: messages.length,
      estimatedTokens: totalTokens,
      windowTokens: estimateTokens(window),
      windowMessages: window.length,
      truncatedCount: trimmedTruncated,
    },
  };
}

export interface RecallResult {
  query: string;
  chunks: number;
  tokens: number;
  results: { timestamp: string; text: string; distance: number }[];
}

// Inject relevant old context when messages have been trimmed from the window.
export async function injectRecall(
  messages: ModelMessage[],
  query: string,
  recallIndex: RecallIndex | null,
  trimmedCount: number,
  autoRecall: boolean,
): Promise<{ messages: ModelMessage[]; recall: RecallResult | null }> {
  if (trimmedCount <= 0 || !recallIndex || !autoRecall) {
    return { messages, recall: null };
  }

  try {
    const results = await recallIndex.search(query, 3);
    // Filter: distance threshold + skip chunks already in context window
    const contextStart = trimmedCount; // messages before this index were trimmed
    const relevant = results.filter(r => r.distance < 0.95 && r.msg_end < contextStart);
    if (relevant.length === 0) {
      return { messages, recall: null };
    }

    const recallText = relevant
      .map(r => `[${r.timestamp}]\n${r.text}`)
      .join("\n---\n");
    const recallMsg: ModelMessage = {
      role: "user",
      content: `<recall>\nRelevant context from past conversations:\n${recallText}\n</recall>`,
    };
    // Budget: only inject if it fits within ~2000 tokens
    const recallTokens = getMsgSize(recallMsg);
    if (recallTokens > 2000) {
      return { messages, recall: null };
    }

    log("recall", `auto-recall: injected ${relevant.length} chunks (~${recallTokens} tokens)`);
    return {
      messages: [recallMsg, ...messages],
      recall: {
        query,
        chunks: relevant.length,
        tokens: recallTokens,
        results: relevant.map(r => ({ timestamp: r.timestamp, text: r.text, distance: r.distance })),
      },
    };
  } catch (err: any) {
    log("recall", `auto-recall failed: ${err.message}`);
    return { messages, recall: null };
  }
}
