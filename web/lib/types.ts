// Shared type definitions

export interface AgentInfo {
  name: string;
  running: boolean;
  serverUrl?: string; // undefined = local proxy
  token: string;
}

export interface ServerConfig {
  url: string;
  token: string;
}

// Discriminated union for SSE events
export type StreamEvent =
  | { type: "connection"; connectionId: string }
  | { type: "thinking" }
  | { type: "text-delta"; text: string }
  | { type: "tool-call"; toolName: string; toolInput?: Record<string, unknown> }
  | { type: "tool-result"; output?: string; result?: string; toolResult?: string }
  | { type: "recall"; text: string }
  | { type: "finish"; text?: string }
  | { type: "error"; error: string }
  | { type: "command-result"; text: string; command?: string }
  | { type: "incoming"; text: string; fromInterface?: string; fromUserId?: string; fromChannel?: string; media?: MediaItem[] }
  | { type: "outgoing"; text: string; fromInterface?: string }
  | { type: "heartbeat" }
  | { type: "render"; render: { html: string; dashboard?: string | null; target: string; title: string } };

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
  image?: string;
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
  index?: number;
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

export interface DashboardInfo {
  name: string;
  agentName: string;
  serverUrl?: string;
  token: string;
}

export interface MediaItem {
  type: "image" | "file";
  url: string;
  filename?: string;
}

// A rendered message block in the chat UI
export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool" | "heartbeat" | "incoming" | "error" | "command" | "render";
  text: string;
  timestamp?: string | null;
  iface?: string;
  meta?: string;
  // Media
  media?: MediaItem[];
  // Tool fields
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolOutput?: string;
  toolCallId?: string;
  // Render fields
  renderHtml?: string;
  renderTarget?: string;
  renderTitle?: string;
  renderDashboard?: string | null;
  // UI flags
  hidden?: boolean;
  streaming?: boolean;
}
