"use client";

import type { ChatMessage } from "../lib/types";
import { ChatLayout } from "./layouts/ChatLayout";
import { SlackLayout } from "./layouts/SlackLayout";

interface ChatProps {
  messages: ChatMessage[];
  streamParts: ChatMessage[];
  thinking: boolean;
  agentName?: string;
  token?: string;
  layout: "chat" | "slack";
  showTools?: boolean;
  coloredTools?: boolean;
  peekLastTool?: boolean;
}

export function Chat({ messages, streamParts, thinking, agentName, token, layout, showTools = true, coloredTools = true, peekLastTool = true }: ChatProps) {
  const shared = { messages, streamParts, thinking, agentName, token, showTools, coloredTools, peekLastTool };

  if (layout === "slack") {
    return <SlackLayout {...shared} />;
  }
  return <ChatLayout {...shared} />;
}
