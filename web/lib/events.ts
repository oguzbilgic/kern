// Pure SSE event → state reducers (no React dependencies)

import type { ChatMessage, StreamEvent } from "./types";
import { parseUserContent } from "./messages";
import { isRenderToolCall as isRenderTool } from "../plugins/dashboard";

/**
 * Process an SSE event against the current streaming parts buffer.
 * Returns updated parts array and any messages to append to history.
 * Pure function — caller manages React state.
 *
 * Note: thinking state is NOT managed here. The caller (useAgent)
 * handles thinking based on event types directly.
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
          // Hide render tool calls — the render event creates the visible block (dashboard plugin)
          const tn = result.parts[i].toolName;
          if (tn && isRenderTool(tn)) {
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
        (p) => p.role === "render" || (p.role === "tool" && !p.hidden) || (p.role === "assistant" && p.text.trim())
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

    case "render": {
      const rTitle = ev.render.title || "Render";
      const rTarget = ev.render.target || "inline";
      const target = inTurn ? result.parts : result.append;
      target.push({
        id: `render-${Date.now()}`,
        role: "render",
        text: rTitle,
        renderHtml: ev.render.html,
        renderTarget: rTarget,
        renderTitle: rTitle,
        renderDashboard: ev.render.dashboard,
      });
      // Auto-open panel for panel-target renders
      if (rTarget === "panel") {
        result.panelRender = { html: ev.render.html, title: rTitle };
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
