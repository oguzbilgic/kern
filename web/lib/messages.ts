// Message parsing and transformation utilities

import type { HistoryMessage, ChatMessage, ParsedUserMessage, ContentPart, MediaItem } from "./types";
import { getPlugins } from "../plugins/registry";

let msgCounter = 0;

/**
 * True if an assistant reply should be rendered muted (the outbound interfaces
 * have already suppressed it). Matches empty text, the "(no text response)"
 * placeholder, or any text ending with NO_REPLY — mirrors src/util.ts#isNoReply.
 */
export function isNoReply(text: string | null | undefined): boolean {
  if (!text) return true;
  const t = text.trim();
  if (!t) return true;
  if (t === "(no text response)") return true;
  return t.endsWith("NO_REPLY");
}

/** Ask plugins to convert a tool result to a custom message. Returns null if no plugin handles it. */
function pluginToolResult(toolName: string, output: string): ChatMessage | null {
  for (const plugin of getPlugins()) {
    const msg = plugin.handleHistoryToolResult?.(toolName, output);
    if (msg) return msg;
  }
  return null;
}

/** Check if any plugin wants to hide this tool */
function pluginHidesTool(toolName: string): boolean {
  return getPlugins().some(p => p.isHiddenTool?.(toolName));
}

export function parseUserContent(content: string): ParsedUserMessage {
  const match = content.match(
    /^\[via ([^,]+),?\s*([^,]*),?\s*user:\s*([^,\]]*),?\s*(?:time:\s*([^\]]*))?\]\n?([\s\S]*)$/
  );
  if (match) {
    const [, iface, , userId, time, text] = match;
    const cleanText = (text || "").trim() || "(empty)";
    const timestamp = time ? time.trim() : null;
    const ifaceTrimmed = iface.trim();
    if (ifaceTrimmed === "tui" || ifaceTrimmed === "web")
      return { type: "user", text: cleanText, timestamp, iface: ifaceTrimmed };
    if (ifaceTrimmed === "system")
      return { type: "heartbeat", text: "", iface: "heartbeat" };
    return {
      type: "incoming",
      text: cleanText,
      meta: `[${ifaceTrimmed} ${userId.trim()}]`,
      timestamp,
      iface: "incoming",
    };
  }
  if (content === "[heartbeat]" || content.startsWith("[heartbeat"))
    return { type: "heartbeat", text: "", iface: "heartbeat" };
  return { type: "user", text: content };
}

function extractText(content: string | ContentPart[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((p) => p.type === "text" && p.text)
    .map((p) => p.text!)
    .join("\n");
}

function extractMedia(content: string | ContentPart[]): MediaItem[] {
  if (!Array.isArray(content)) return [];
  const items: MediaItem[] = [];
  for (const p of content) {
    if (p.type === "image") {
      const ref = p.image;
      const file = ref?.startsWith("kern-media://") ? ref.slice("kern-media://".length) : null;
      if (file) items.push({ type: "image", url: file, filename: p.filename });
    } else if (p.type === "file") {
      const ref = typeof p.data === "string" ? p.data : undefined;
      const file = ref?.startsWith("kern-media://") ? ref.slice("kern-media://".length) : null;
      if (file) items.push({ type: "file", url: file, filename: p.filename });
    }
  }
  return items;
}

function extractToolResultOutput(part: ContentPart): string {
  const output = part.output;
  if (!output) return part.text || "";
  if (typeof output === "string") return output;
  // Array of parts
  if (Array.isArray(output)) {
    return output
      .filter((p: ContentPart) => p.type === "text")
      .map((p: ContentPart) => p.text || p.value || "")
      .join("\n");
  }
  // SDK format: { type: "text", value: "..." }
  const obj = output as { type: string; value: string };
  if (obj.type === "text" && obj.value) return obj.value;
  return JSON.stringify(output);
}

function findLastUnresolvedTool(messages: ChatMessage[]): ChatMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "tool" && messages[i].toolOutput === undefined) return messages[i];
  }
  return undefined;
}

export function historyToMessages(history: HistoryMessage[]): ChatMessage[] {
  const messages: ChatMessage[] = [];

  for (const msg of history) {
    const content = msg.content;

    if (msg.role === "user") {
      const text = extractText(content);
      const parsed = parseUserContent(text);
      const media = extractMedia(content);
      if (parsed.type === "heartbeat") {
        messages.push({
          id: `msg-${msgCounter++}`,
          role: "heartbeat",
          text: "♡ heartbeat",
          timestamp: parsed.timestamp,
          iface: "heartbeat",
        });
      } else if (parsed.type === "incoming") {
        messages.push({
          id: `msg-${msgCounter++}`,
          role: "incoming",
          text: parsed.text,
          meta: parsed.meta,
          timestamp: parsed.timestamp,
          iface: parsed.iface,
          ...(media.length > 0 && { media }),
        });
      } else {
        messages.push({
          id: `msg-${msgCounter++}`,
          role: "user",
          text: parsed.text,
          timestamp: parsed.timestamp,
          iface: parsed.iface,
          ...(media.length > 0 && { media }),
        });
      }
      continue;
    }

    if (msg.role === "assistant") {
      if (typeof content === "string") {
        if (content.trim()) {
          messages.push({
            id: `msg-${msgCounter++}`,
            role: "assistant",
            text: content.trim(),
          });
        }
        continue;
      }

      // Content is array of parts — can contain text AND tool-calls
      // Collect tool-calls by toolCallId so we can pair with results later
      if (Array.isArray(content)) {
        for (const part of content) {
          if (part.type === "text" && part.text?.trim()) {
            messages.push({
              id: `msg-${msgCounter++}`,
              role: "assistant",
              text: part.text.trim(),
            });
          } else if (part.type === "tool-call") {
            // Create tool entry keyed by toolCallId for later result matching
            const toolMsg: ChatMessage = {
              id: `msg-${msgCounter++}`,
              role: "tool",
              text: "",
              toolName: part.toolName,
              toolInput: part.input,
              toolCallId: part.toolCallId,
            };
            messages.push(toolMsg);
          }
        }
      }
      continue;
    }

    if (msg.role === "tool") {
      if (typeof content === "string") {
        // Attach to last unresolved tool message
        const lastTool = findLastUnresolvedTool(messages);
        if (lastTool) {
          lastTool.toolOutput = content;
          // Delegate to plugins for tool result conversion
          if (lastTool.toolName && pluginHidesTool(lastTool.toolName)) {
            const pluginMsg = pluginToolResult(lastTool.toolName, content);
            if (pluginMsg) {
              lastTool.hidden = true;
              messages.push({ ...pluginMsg, id: `msg-${msgCounter++}` });
            }
          }
        }
        continue;
      }

      // Content is array of tool-result parts — match to existing tool-call entries
      if (Array.isArray(content)) {
        for (const part of content) {
          if (part.type === "tool-result") {
            const output = extractToolResultOutput(part);
            // Find the matching tool-call by toolCallId
            const match = part.toolCallId
              ? messages.find((m) => m.toolCallId === part.toolCallId)
              : findLastUnresolvedTool(messages);
            if (match) {
              match.toolOutput = output;
              // Delegate to plugins for tool result conversion
              if (match.toolName && pluginHidesTool(match.toolName) && output) {
                const pluginMsg = pluginToolResult(match.toolName, output);
                if (pluginMsg) {
                  match.hidden = true;
                  messages.push({ ...pluginMsg, id: `msg-${msgCounter++}` });
                }
              }
            }
          }
        }
      }
      continue;
    }
  }

  return messages;
}

// Check if text is emoji-only (1-3 emoji, no other text)
export function isEmojiOnly(text: string): boolean {
  const emojiRegex = /^(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F){1,3}$/u;
  return emojiRegex.test(text.trim());
}

// Format timestamp for display
export function formatTime(isoString: string | null | undefined): string {
  if (!isoString) return "";
  try {
    const d = new Date(isoString);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) {
      return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    }
    return d.toLocaleDateString([], { month: "short", day: "numeric" }) +
      " " + d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

// Parsed message props — all the business logic about a message, no rendering
export interface MessageProps {
  msg: ChatMessage;
  isUser: boolean;
  isAssistant: boolean;
  isIncoming: boolean;
  isHeartbeat: boolean;
  isCommand: boolean;
  isError: boolean;
  isNoReply: boolean;
  isEmoji: boolean;
  senderName: string;
  initials: string;
  channel?: string; // telegram, slack, hub
}

const CHANNEL_INFO: Record<string, { icon: string; color: string; bg: string }> = {
  telegram: { icon: "✈", color: "#58a6ff", bg: "#1c2d3d" },
  slack:    { icon: "#",  color: "#e6b450", bg: "#2d2a1c" },
  hub:      { icon: "◆",  color: "#a78bfa", bg: "#2a1c3d" },
  matrix:   { icon: "▲",  color: "#7ee787", bg: "#1c3d26" },
  subagent: { icon: "⎘",  color: "#f2a365", bg: "#3d2a1c" },
};

export function getChannelInfo(channel?: string) {
  return channel ? CHANNEL_INFO[channel] : undefined;
}

function parseChannel(meta?: string): string | undefined {
  if (!meta) return undefined;
  // incoming: "[telegram 812345]" or "[slack #chan user]"
  const inMatch = meta.match(/^\[(\w+)/);
  if (inMatch) return inMatch[1].toLowerCase();
  // outgoing: "→ telegram"
  const outMatch = meta.match(/^→\s*(\w+)/);
  if (outMatch) return outMatch[1].toLowerCase();
  return undefined;
}

export function analyzeMessage(msg: ChatMessage, agentName?: string): MessageProps {
  const isUser = msg.role === "user";
  const isAssistant = msg.role === "assistant";
  const isIncoming = msg.role === "incoming";
  const isHeartbeat = msg.role === "heartbeat";
  const isCommand = msg.role === "command";
  const isError = msg.role === "error";
  const isNoReplyMsg = isAssistant && isNoReply(msg.text);
  const isEmoji = isUser && isEmojiOnly(msg.text);
  const isOutgoing = isAssistant && !!msg.meta?.startsWith("→");
  const channel = (isIncoming || isOutgoing) ? parseChannel(msg.meta) : undefined;
  const senderName = isUser ? "You" : isHeartbeat ? "heartbeat" : isIncoming ? (channel || "incoming") : (agentName || "Agent");
  const initials = senderName.charAt(0).toUpperCase();

  return { msg, isUser, isAssistant, isIncoming, isHeartbeat, isCommand, isError, isNoReply: isNoReplyMsg, isEmoji, senderName, initials, channel };
}

// Compute continuation and tool-header flags for a message list
export interface MessageGroupInfo {
  continuation: boolean;
  needsAgentHeader: boolean;
}

export function computeGroups(msgs: ChatMessage[], showTools: boolean): Map<string, MessageGroupInfo> {
  const result = new Map<string, MessageGroupInfo>();
  let prevVisibleRole: string | null = null;

  for (const msg of msgs) {
    if (msg.role === "tool" && !showTools) {
      result.set(msg.id, { continuation: false, needsAgentHeader: false });
      continue;
    }

    if (msg.role === "tool") {
      const needsAgentHeader = prevVisibleRole !== "assistant";
      prevVisibleRole = "assistant";
      result.set(msg.id, { continuation: false, needsAgentHeader });
      continue;
    }

    const role = msg.role;
    const continuation = role === prevVisibleRole;
    prevVisibleRole = role;
    result.set(msg.id, { continuation, needsAgentHeader: false });
  }

  return result;
}
