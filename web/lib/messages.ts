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
