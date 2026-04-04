import type { ModelMessage } from "ai";
import type { StreamEvent } from "../runtime.js";

export interface Attachment {
  type: "image" | "audio" | "video" | "document";
  data: Buffer;
  mimeType: string;
  filename?: string;
  size: number;
}

export interface IncomingMessage {
  text: string;
  userId: string;
  chatId: string;
  interface: string;
  channel?: string;
  attachments?: Attachment[];
}

export type MessageHandler = (
  msg: IncomingMessage,
  onEvent: (event: StreamEvent) => void,
) => Promise<string>;

export interface StartOptions {
  onMessage: MessageHandler;
  history?: ModelMessage[];
}

export interface Interface {
  start(options: StartOptions): Promise<void>;
  stop(): Promise<void>;
}
