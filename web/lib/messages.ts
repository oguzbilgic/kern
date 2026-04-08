// Message parsing and transformation utilities

import type { HistoryMessage, ChatMessage, ParsedUserMessage, ContentPart } from "./types";

let msgCounter = 0;

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

export function historyToMessages(history: HistoryMessage[]): ChatMessage[] {
  const messages: ChatMessage[] = [];

  for (const msg of history) {
    if (msg.role === "user") {
      const text = extractText(msg.content);
      const parsed = parseUserContent(text);
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
        });
      } else {
        messages.push({
          id: `msg-${msgCounter++}`,
          role: "user",
          text: parsed.text,
          timestamp: parsed.timestamp,
          iface: parsed.iface,
        });
      }
    } else if (msg.role === "assistant") {
      const text = extractText(msg.content);
      // Tool calls are embedded in assistant messages
      if (msg.toolName) {
        messages.push({
          id: `msg-${msgCounter++}`,
          role: "tool",
          text: "",
          toolName: msg.toolName,
          toolInput: msg.toolInput,
          toolOutput: typeof msg.result === "string" ? msg.result : extractText(msg.result || []),
        });
      } else if (text.trim()) {
        messages.push({
          id: `msg-${msgCounter++}`,
          role: "assistant",
          text: text.trim(),
        });
      }
    } else if (msg.role === "tool") {
      // Standalone tool result
      messages.push({
        id: `msg-${msgCounter++}`,
        role: "tool",
        text: "",
        toolName: msg.toolName,
        toolInput: msg.toolInput,
        toolOutput: typeof msg.content === "string" ? msg.content : extractText(msg.content),
      });
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
