// Pure SSE event → state reducers (no React dependencies)

import type { ChatMessage, StreamEvent } from "./types";
import { parseUserContent } from "./messages";
import { getPlugins } from "../plugins/registry";

/**
 * Process an SSE event against the current streaming parts buffer.
 * Returns updated parts array and any messages to append to history.
 * Pure function — caller manages React state.
 *
 * Delegates to registered UI plugins for unknown event types and
 * tool call hiding.
 */
export function processStreamEvent(
  ev: StreamEvent,
  parts: ChatMessage[],
  inTurn: boolean = false
): {
  parts: ChatMessage[];
  append: ChatMessage[];
  flush: boolean;
  panelRender?: { html: string; title: string };
} {
  const result = {
    parts: [...parts],
    append: [] as ChatMessage[],
    flush: false,
    panelRender: undefined as { html: string; title: string } | undefined,
  };

  switch (ev.type) {
    case "thinking":
      break;

    case "text-delta": {
      const last = result.parts[result.parts.length - 1];
      if (last?.role === "assistant") {
        last.text += ev.text;
      } else {
        result.parts.push({
          id: `stream-text-${Date.now()}-${Math.random()}`,
          role: "assistant",
          text: ev.text,
        });
      }
      break;
    }

    case "tool-call":
      result.parts.push({
        id: `stream-tool-${Date.now()}-${Math.random()}`,
        role: "tool",
        text: "",
        toolName: ev.toolName,
        toolInput: ev.toolInput,
        streaming: true,
      });
      break;

    case "tool-result": {
      for (let i = result.parts.length - 1; i >= 0; i--) {
        if (result.parts[i].role === "tool" && result.parts[i].streaming) {
          result.parts[i] = {
            ...result.parts[i],
            toolOutput: ev.toolResult || ev.output || ev.result,
            streaming: false,
          };
          // Ask plugins if this tool call should be hidden
          const tn = result.parts[i].toolName;
          if (tn && isPluginHiddenTool(tn)) {
            result.parts[i].hidden = true;
          }
          break;
        }
      }
      break;
    }

    case "recall":
      result.parts.push({
        id: `stream-recall-${Date.now()}`,
        role: "tool",
        text: "",
        toolName: "recall",
        toolOutput: ev.text,
      });
      break;

    case "finish": {
      result.append = result.parts.filter(
        (p) => isPluginRole(p.role) || (p.role === "tool" && !p.hidden) || (p.role === "assistant" && p.text.trim())
      );
      result.parts = [];
      result.flush = true;
      break;
    }

    case "incoming": {
      const parsed = parseUserContent(ev.text);
      const target = inTurn ? result.parts : result.append;
      if (parsed.type === "heartbeat") {
        target.push({
          id: `hb-${Date.now()}`,
          role: "heartbeat",
          text: "♡ heartbeat",
          iface: "heartbeat",
        });
      } else {
        target.push({
          id: `in-${Date.now()}`,
          role: "incoming",
          text: parsed.text || ev.text,
          meta: `[${ev.fromInterface || "?"} ${ev.fromUserId || ""}]`.trim(),
          iface: ev.fromInterface,
          media: ev.media,
        });
      }
      break;
    }

    case "outgoing": {
      const target = inTurn ? result.parts : result.append;
      target.push({
        id: `out-${Date.now()}`,
        role: "assistant",
        text: ev.text,
        meta: `→ ${ev.fromInterface || "?"}`,
        iface: ev.fromInterface,
      });
      break;
    }

    case "heartbeat": {
      const target = inTurn ? result.parts : result.append;
      target.push({
        id: `hb-${Date.now()}`,
        role: "heartbeat",
        text: "♡ heartbeat",
        iface: "heartbeat",
      });
      break;
    }

    case "command-result":
      result.append.push({
        id: `cmd-${Date.now()}`,
        role: "command",
        text: ev.text,
        meta: `/${ev.command}`,
      });
      break;

    default: {
      // Delegate to plugins for unknown event types
      const pluginResult = delegateToPlugins(ev, inTurn);
      if (pluginResult) {
        const target = inTurn ? result.parts : result.append;
        if (pluginResult.message) target.push(pluginResult.message);
        if (pluginResult.panelOpen) result.panelRender = pluginResult.panelOpen;
      }
      break;
    }

    case "error":
      result.append.push({
        id: `err-${Date.now()}`,
        role: "error",
        text: ev.error,
      });
      result.parts = [];
      break;
  }

  return result;
}

// --- Plugin delegation helpers ---

/** Check if any plugin wants to hide this tool call */
function isPluginHiddenTool(toolName: string): boolean {
  return getPlugins().some(p => p.isHiddenTool?.(toolName));
}

/** Check if a role belongs to any plugin (for finish filtering) */
function isPluginRole(role: string): boolean {
  return getPlugins().some(p => p.renderMessage !== undefined && role !== "user" && role !== "assistant" && role !== "tool" && role !== "heartbeat" && role !== "incoming" && role !== "error" && role !== "command");
}

/** Try all plugins to handle an unknown event */
function delegateToPlugins(ev: StreamEvent, inTurn: boolean) {
  for (const plugin of getPlugins()) {
    const result = plugin.handleStreamEvent?.(ev, inTurn);
    if (result) return result;
  }
  return null;
}
