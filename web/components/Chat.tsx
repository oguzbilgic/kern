"use client";

import type { ChatMessage } from "../lib/types";
import { BubbleLayout } from "./layouts/BubbleLayout";
import { FlatLayout } from "./layouts/FlatLayout";

interface ChatProps {
  messages: ChatMessage[];
  streamParts: ChatMessage[];
  thinking: boolean;
  agentName?: string;
  token?: string;
  serverUrl?: string;
  layout: "bubble" | "flat";
  showTools?: boolean;
  coloredTools?: boolean;
  peekLastTool?: boolean;
}

export function Chat({ messages, streamParts, thinking, agentName, token, serverUrl, layout, showTools = true, coloredTools = true, peekLastTool = true }: ChatProps) {
  const shared = { messages, streamParts, thinking, agentName, token, serverUrl, showTools, coloredTools, peekLastTool };

  if (layout === "flat") {
    return <FlatLayout {...shared} />;
  }
  return <BubbleLayout {...shared} />;
}
