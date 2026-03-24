import type { ModelMessage } from "ai";

export interface IncomingMessage {
  text: string;
  userId: string;
  chatId: string;
}

export interface StartOptions {
  onMessage: (msg: IncomingMessage) => Promise<string>;
  history?: ModelMessage[];
}

export interface Interface {
  start(options: StartOptions): Promise<void>;
  stop(): Promise<void>;
}
