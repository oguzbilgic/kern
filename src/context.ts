import type { ModelMessage, SystemModelMessage, ToolResultPart } from "ai";
import { readFile } from "fs/promises";
import { join } from "path";
import { existsSync } from "fs";
import { log } from "./log.js";
import { getToolsForScope, type KernConfig } from "./config.js";
import type { RecallIndex } from "./recall.js";
import type { MemoryDB } from "./memory.js";
import type { SegmentIndex } from "./segments.js";
import { loadNotesContext } from "./notes.js";

function wrapDocument(pathLabel: string, content: string): string {
  const safePath = pathLabel.replace(/"/g, '&quot;');
  return `<document path="${safePath}">\n${content.trim()}\n</document>`;
}

function wrapNotesSummary(content: string): string {
  return `<notes_summary>\n${content.trim()}\n</notes_summary>`;
}

function wrapTools(content: string): string {
  return `<tools>\n${content.trim()}\n</tools>`;
}

// Build the system prompt from agent markdown files + runtime info.
export async function loadSystemPrompt(agentDir: string, config: KernConfig, memoryDB?: MemoryDB | null): Promise<string> {
  const parts: string[] = [];

  // Load AGENTS.md (kernel)
  const agentsPath = join(agentDir, "AGENTS.md");
  if (existsSync(agentsPath)) {
    parts.push(wrapDocument("AGENTS.md", await readFile(agentsPath, "utf-8")));
  }

  // Load IDENTITY.md
  const identityPath = join(agentDir, "IDENTITY.md");
  if (existsSync(identityPath)) {
    parts.push(wrapDocument("IDENTITY.md", await readFile(identityPath, "utf-8")));
  }

  // Load KERN.md (runtime context) — from agent dir first, fall back to kern package
  const kernMdAgent = join(agentDir, "KERN.md");
  const kernMdPackage = join(import.meta.dirname, "..", "templates", "KERN.md");
  if (existsSync(kernMdAgent)) {
    parts.push(wrapDocument("KERN.md", await readFile(kernMdAgent, "utf-8")));
  } else if (existsSync(kernMdPackage)) {
    parts.push(wrapDocument("KERN.md", await readFile(kernMdPackage, "utf-8")));
  }

  // Load KNOWLEDGE.md (memory index)
  const knowledgePath = join(agentDir, "KNOWLEDGE.md");
  if (existsSync(knowledgePath)) {
    parts.push(wrapDocument("KNOWLEDGE.md", await readFile(knowledgePath, "utf-8")));
  }

  // Load USERS.md (paired users)
  const usersPath = join(agentDir, "USERS.md");
  if (existsSync(usersPath)) {
    parts.push(wrapDocument("USERS.md", await readFile(usersPath, "utf-8")));
  }

  // Inject notes context: summary of recent days + latest daily note
  try {
    const { latest, summary, latestFile } = await loadNotesContext(agentDir, config, memoryDB ?? null);
    if (summary) {
      parts.push(wrapNotesSummary(summary));
    }
    if (latest && latestFile) {
      parts.push(wrapDocument(`notes/${latestFile}`, latest));
    }
  } catch (err: any) {
    log.error("context", `failed to load notes context: ${err.message}`);
  }

  // Inject live runtime info
  const tools = getToolsForScope(config.toolScope);
  const toolDescriptions: Record<string, string> = {
    bash: "run shell commands",
    pwsh: "run PowerShell commands (Windows)",
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

  parts.push(wrapTools(toolList));

  if (parts.length === 0) {
    return "You are a helpful AI assistant.";
  }

  return parts.join("\n\n");
}

// Token estimate: stringify everything, ~3.3 chars per token + per-message overhead.
// chars/4 underestimates by ~25% vs actual tokenizer output.
// Per-message overhead accounts for API framing not captured in JSON.stringify.
const CHARS_PER_TOKEN = 3.3;
const PER_MESSAGE_OVERHEAD = 4; // role/separator tokens per message

export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function estimateTokens(messages: ModelMessage[]): number {
  let chars = 0;
  for (const msg of messages) {
    chars += JSON.stringify(msg).length;
  }
  return Math.ceil(chars / CHARS_PER_TOKEN) + (messages.length * PER_MESSAGE_OVERHEAD);
}

// Per-message token size cache
const msgSizeCache = new WeakMap<ModelMessage, number>();

function getMsgSize(msg: ModelMessage): number {
  let size = msgSizeCache.get(msg);
  if (size === undefined) {
    size = Math.ceil(JSON.stringify(msg).length / CHARS_PER_TOKEN) + PER_MESSAGE_OVERHEAD;
    msgSizeCache.set(msg, size);
  }
  return size;
}

// Truncate oversized tool results to keep context window usable.
// Full results remain in session JSONL (and recall index) — only the context copy is truncated.
function truncateLargeToolResults(messages: ModelMessage[], maxChars: number, tokenBudget: number = 0): { messages: ModelMessage[]; truncatedCount: number } {
  if (maxChars <= 0) return { messages, truncatedCount: 0 };

  // Only process messages within 2x the token budget from the end — older ones get trimmed anyway.
  // Exception: any single message larger than maxChars (as tokens) is always truncated,
  // even if it falls outside the 2x window — otherwise it poisons trimToTokenBudget().
  const maxCharsTokens = Math.ceil(maxChars / 4);
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
  const result: ModelMessage[] = [];

  for (let idx = 0; idx < messages.length; idx++) {
    const msg = messages[idx];
    // Skip non-tool messages, and skip tool messages before startIndex unless they're oversized
    if (msg.role !== "tool" || !Array.isArray(msg.content)) {
      result.push(msg);
      continue;
    }
    if (idx < startIndex && getMsgSize(msg) <= maxCharsTokens) {
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

interface TrimOptions {
  messages: ModelMessage[];
  maxTokens: number;
  /** Snap trim boundary for cache stability. Requires segmentIndex + sessionId. */
  segmentIndex?: SegmentIndex | null;
  sessionId?: string;
}

const TRIM_SNAP = 20;

/**
 * Trim oldest messages to fit within a token budget.
 *
 * The cut point is always a user message (turn boundary) to avoid orphaning
 * tool_result blocks. When segment data is available, the cut point is snapped
 * to a stable position (L0 segment edge or round-20 boundary) so the message
 * window prefix stays byte-identical across consecutive turns — critical for
 * prompt caching.
 */
function trimToTokenBudget({ messages, maxTokens, segmentIndex, sessionId }: TrimOptions): { messages: ModelMessage[]; trimmedCount: number } {
  if (maxTokens <= 0) return { messages, trimmedCount: 0 };

  // Compute total using cached per-message sizes
  let total = 0;
  for (const msg of messages) {
    total += getMsgSize(msg);
  }
  if (total <= maxTokens) return { messages, trimmedCount: 0 };

  // Find initial cut point from the front
  let cutTotal = total;
  let cutIndex = 0;
  while (cutIndex < messages.length - 1 && cutTotal > maxTokens) {
    cutTotal -= getMsgSize(messages[cutIndex]);
    cutIndex++;
  }

  // Walk forward to a user message (turn-safe boundary)
  while (cutIndex < messages.length - 1 && messages[cutIndex].role !== "user") {
    cutIndex++;
  }

  // Snap to a stable position for cache stability.
  // Find a snap target (L0 segment end or round number), then walk backward
  // to the nearest user message so we never cut inside a tool-use/tool-result pair.
  if (cutIndex > 0) {
    let snapTarget = cutIndex;

    // Try L0 segment end — aligns with summarized region boundary
    if (segmentIndex && sessionId) {
      const l0Ends = segmentIndex.getL0Boundaries(sessionId);
      const l0Snap = l0Ends.find(s => s >= cutIndex);
      if (l0Snap !== undefined && l0Snap < messages.length - 4) {
        snapTarget = l0Snap;
      }
    }

    // Fall back to round number if no L0 edge found
    if (snapTarget === cutIndex) {
      const roundSnap = Math.ceil(cutIndex / TRIM_SNAP) * TRIM_SNAP;
      if (roundSnap > cutIndex && roundSnap < messages.length - 4) {
        snapTarget = roundSnap;
      }
    }

    // Walk backward from snap target to nearest user message for turn safety
    if (snapTarget > cutIndex) {
      let safeSnap = snapTarget;
      while (safeSnap > cutIndex && messages[safeSnap]?.role !== "user") {
        safeSnap--;
      }
      if (safeSnap > cutIndex && messages[safeSnap]?.role === "user") {
        log.debug("context", `trim snap: ${cutIndex} → ${safeSnap} (target ${snapTarget}, +${safeSnap - cutIndex} msgs)`);
        cutIndex = safeSnap;
      }
    }
  }

  return { messages: messages.slice(cutIndex), trimmedCount: cutIndex };
}

export interface ContextSegment {
  id: number;
  level: number;
  msg_start: number;
  msg_end: number;
}

export interface SessionStats {
  totalMessages: number;
  estimatedTokens: number;
  windowTokens: number;
  windowMessages: number;
  truncatedCount: number;
  summaryTokens: number;
  summaryLevelCounts: Record<number, number>;
  /** Segments selected for context injection */
  summarySegments: ContextSegment[];
  systemPromptTokens?: number;
}

export interface PrepareContextOptions {
  messages: ModelMessage[];
  config: KernConfig;
  sessionId?: string;
  segmentIndex?: SegmentIndex | null;
}

export interface PreparedContext {
  systemAdditions: string[];
  messages: ModelMessage[];
  stats: SessionStats;
}

// Unified pipeline: truncate → trim → inject summary → stats.
export function prepareContext({ messages, config, sessionId, segmentIndex }: PrepareContextOptions): PreparedContext {
  const totalTokens = estimateTokens(messages);
  const { messages: truncated, truncatedCount } = truncateLargeToolResults(messages, config.maxToolResultChars, config.maxContextTokens);
  const rawBudget = segmentIndex && config.summaryBudget > 0
    ? Math.round(config.maxContextTokens * (1 - config.summaryBudget))
    : config.maxContextTokens;
  let { messages: window, trimmedCount } = trimToTokenBudget({
    messages: truncated,
    maxTokens: rawBudget,
    segmentIndex,
    sessionId,
  });

  // Inject compressed summary at trim boundary
  let summaryTokens = 0;
  let summaryLevelCounts: Record<number, number> = {};
  let summarySegments: ContextSegment[] = [];
  let summarySystemAddition = "";
  const finalMessages = window;
  if (trimmedCount > 0 && segmentIndex && sessionId && config.summaryBudget > 0) {
    const budgetTokens = Math.round(config.maxContextTokens * config.summaryBudget);
    const history = segmentIndex.composeHistory(sessionId, trimmedCount, budgetTokens);
    if (history) {
      summaryTokens = history.tokens;
      summaryLevelCounts = history.levelCounts;
      summarySegments = history.segments.map(s => ({ id: s.id, level: s.level, msg_start: s.msg_start, msg_end: s.msg_end }));
      summarySystemAddition = `<conversation_summary>\nCompressed conversation summary of trimmed earlier messages (oldest → newest). Use recall tool to load full messages by range.\n\n${history.text}\n</conversation_summary>`;
    }
  }

  // Only count truncations that survived trimming
  // FRAGILE: matches suffix appended by truncateLargeToolResults — keep in sync
  const truncationSuffix = "use recall tool to search full content]";
  const trimmedTruncated = truncatedCount > 0
    ? finalMessages.reduce((n, msg) => {
        if (msg.role !== "tool" || !Array.isArray(msg.content)) return n;
        return n + (msg.content as ToolResultPart[]).filter(p =>
          p.type === "tool-result" && p.output?.type === "text" && p.output.value.endsWith(truncationSuffix)
        ).length;
      }, 0)
    : 0;
  return {
    systemAdditions: summarySystemAddition ? [summarySystemAddition] : [],
    messages: finalMessages,
    stats: {
      totalMessages: messages.length,
      estimatedTokens: totalTokens,
      windowTokens: estimateTokens(finalMessages),
      windowMessages: finalMessages.length,
      truncatedCount: trimmedTruncated,
      summaryTokens,
      summaryLevelCounts,
      summarySegments,
    },
  };
}

// ---------------------------------------------------------------------------
// Prompt caching — Anthropic cache breakpoints and system message wrapping
// ---------------------------------------------------------------------------

const CACHE_CONTROL = {
  anthropic: { cacheControl: { type: "ephemeral" } },
  openrouter: { cacheControl: { type: "ephemeral" } },
} as const;

const BP_SNAP_INTERVAL = 20;

/**
 * Check if a model config supports Anthropic-style explicit prompt caching.
 */
export function supportsPromptCaching(config: KernConfig): boolean {
  const { provider, model } = config;
  if (provider === "anthropic") return true;
  if (provider === "openrouter" && model.startsWith("anthropic/")) return true;
  return false;
}

/**
 * Wrap a system prompt string with cache control for Anthropic models.
 * Returns a SystemModelMessage with providerOptions, or the plain string
 * for providers that don't need explicit caching.
 */
export function buildSystemMessage(systemPrompt: string, config: KernConfig): string | SystemModelMessage {
  if (!supportsPromptCaching(config)) return systemPrompt;
  return {
    role: "system" as const,
    content: systemPrompt,
    providerOptions: { ...CACHE_CONTROL },
  };
}

/**
 * Add cache breakpoints to conversation messages for Anthropic models.
 *
 * Uses 2 of Anthropic's 4 allowed breakpoints (BP1 is on the system message):
 *   BP2 "stable"  — snapped to every BP_SNAP_INTERVAL messages, stays fixed ~20 turns
 *   BP3 "turn"    — last user message, stable across all tool-call steps in a turn
 *
 * Between turns: BP2 keeps most of the conversation prefix cached.
 * Mid-turn: BP3 means tool-call steps 1+ get ~99% cache hits.
 */
export function addCacheBreakpoints(messages: ModelMessage[], config: KernConfig): ModelMessage[] {
  if (!supportsPromptCaching(config) || messages.length < 4) return messages;

  // BP3: last user message
  let turnBpIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") { turnBpIdx = i; break; }
  }
  if (turnBpIdx < 0) return messages;

  // BP2: snap to stable interval before the turn breakpoint
  const stableBpIdx = Math.floor(turnBpIdx / BP_SNAP_INTERVAL) * BP_SNAP_INTERVAL;
  const useStableBp = stableBpIdx >= 0 && stableBpIdx < turnBpIdx - 4;

  if (useStableBp) {
    log("context", `cache breakpoints: stable=${stableBpIdx} turn=${turnBpIdx} (${messages.length} msgs)`);
  } else {
    log("context", `cache breakpoint: turn=${turnBpIdx} (${messages.length} msgs)`);
  }

  return messages.map((msg, i) => {
    if (i === turnBpIdx || (useStableBp && i === stableBpIdx)) {
      return {
        ...msg,
        providerOptions: { ...(msg as any).providerOptions, ...CACHE_CONTROL },
      };
    }
    return msg;
  });
}

// ---------------------------------------------------------------------------
// Auto-recall injection
// ---------------------------------------------------------------------------

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

    log.debug("recall", `auto-recall: injected ${relevant.length} chunks (~${recallTokens} tokens)`);
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
    log.error("recall", `auto-recall failed: ${err.message}`);
    return { messages, recall: null };
  }
}
