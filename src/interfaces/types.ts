export interface IncomingMessage {
  text: string;
  userId: string;
  chatId: string;
}

export interface Interface {
  start(onMessage: (msg: IncomingMessage) => Promise<string>): Promise<void>;
  stop(): Promise<void>;
}
