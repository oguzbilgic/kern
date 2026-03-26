export interface QueuedMessage {
  text: string;
  userId: string;
  interface: string;
  channel: string;
  resolve: (response: string) => void;
  reject: (error: Error) => void;
  isHeartbeat?: boolean;
}

export class MessageQueue {
  private queue: QueuedMessage[] = [];
  private processing = false;
  private activeChannel: string | null = null;
  private pendingSameChannel: QueuedMessage[] = [];
  private handler: ((msg: QueuedMessage, pendingMessages: () => QueuedMessage[]) => Promise<string>) | null = null;

  setHandler(fn: (msg: QueuedMessage, pendingMessages: () => QueuedMessage[]) => Promise<string>) {
    this.handler = fn;
  }

  getActiveChannel(): string | null {
    return this.activeChannel;
  }

  enqueue(msg: Omit<QueuedMessage, "resolve" | "reject">): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const queued: QueuedMessage = { ...msg, resolve, reject };

      // If we're processing and this is same channel (not heartbeat), store as pending injection
      if (this.processing && !msg.isHeartbeat && this.activeChannel && msg.channel === this.activeChannel) {
        this.pendingSameChannel.push(queued);
        return;
      }

      this.queue.push(queued);
      this.processNext();
    });
  }

  // Called by prepareStep to get pending same-channel messages
  drainPendingSameChannel(): QueuedMessage[] {
    const pending = [...this.pendingSameChannel];
    this.pendingSameChannel = [];
    return pending;
  }

  private async processNext() {
    if (this.processing) return;
    if (this.queue.length === 0) return;

    this.processing = true;
    const msg = this.queue.shift()!;
    this.activeChannel = msg.isHeartbeat ? null : msg.channel;

    try {
      const response = await this.handler!(msg, () => this.drainPendingSameChannel());
      msg.resolve(response);

      // Resolve any same-channel pending messages with the same response
      for (const pending of this.pendingSameChannel) {
        pending.resolve(response);
      }
      this.pendingSameChannel = [];
    } catch (error: any) {
      msg.reject(error);
      for (const pending of this.pendingSameChannel) {
        pending.reject(error);
      }
      this.pendingSameChannel = [];
    }

    this.processing = false;
    this.activeChannel = null;
    this.processNext();
  }
}
