// Shared type definitions

export interface Agent {
  name: string;
  running: boolean;
  server?: string;
}

export interface StreamEvent {
  type:
    | "connection"
    | "thinking"
    | "text-delta"
    | "tool-call"
    | "tool-result"
    | "recall"
    | "finish"
    | "error"
    | "command-result";
  connectionId?: string;
  text?: string;
  delta?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  output?: string;
  result?: string;
  error?: string;
}

export interface StatusData {
  version?: string;
  model?: string;
  uptime?: string;
  session?: string;
  context?: string;
  apiUsage?: string;
  cacheUsage?: string;
  telegram?: string;
  slack?: string;
  recall?: string;
  hub?: string;
  hubId?: string;
  queue?: string;
  toolScope?: string;
  contextBreakdown?: {
    systemPromptTokens?: number;
    messageTokens: number;
    summaryTokens: number;
    messageCount: number;
  };
}

export interface ContentPart {
  type: "text" | "image" | "file" | "tool-call" | "tool-result";
  text?: string;
  data?: string;
  mimeType?: string;
  filename?: string;
  // tool-call fields
  toolName?: string;
  toolCallId?: string;
  input?: Record<string, unknown>;
  // tool-result fields
  output?: { type: string; value: string } | string | ContentPart[];
  value?: string;
}

export interface HistoryMessage {
  role: "user" | "assistant" | "tool";
  content: string | ContentPart[];
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolCallId?: string;
  result?: string | ContentPart[];
}

export interface Attachment {
  type: "image" | "video" | "audio" | "document";
  mimeType: string;
  filename: string;
  base64: string;
  dataUrl?: string;
  size?: number;
  file?: File;
}

export interface ParsedUserMessage {
  type: "user" | "heartbeat" | "incoming";
  text: string;
  meta?: string;
  timestamp?: string | null;
  iface?: string;
}

// A rendered message block in the chat UI
export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool" | "heartbeat" | "incoming" | "error";
  text: string;
  timestamp?: string | null;
  iface?: string;
  meta?: string;
  // Tool fields
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: string;
  // Streaming
  streaming?: boolean;
}
