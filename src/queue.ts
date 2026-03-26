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
  private timeoutMs = 5 * 60 * 1000; // 5 minute timeout per message

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
        process.stderr.write(`[kern:queue] same-channel message queued for injection (${msg.channel})\n`);
        return;
      }

      this.queue.push(queued);
      process.stderr.write(`[kern:queue] enqueued (${msg.interface}:${msg.channel || "?"}) depth=${this.queue.length} processing=${this.processing}\n`);
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

    process.stderr.write(`[kern:queue] processing (${msg.interface}:${msg.channel || "?"}) remaining=${this.queue.length}\n`);

    try {
      // Race handler against timeout
      const response = await Promise.race([
        this.handler!(msg, () => this.drainPendingSameChannel()),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error("Message processing timed out")), this.timeoutMs)
        ),
      ]);

      msg.resolve(response);

      for (const pending of this.pendingSameChannel) {
        pending.resolve(response);
      }
      this.pendingSameChannel = [];
    } catch (error: any) {
      process.stderr.write(`[kern:queue] error: ${error.message}\n`);
      msg.reject(error);
      for (const pending of this.pendingSameChannel) {
        pending.reject(error);
      }
      this.pendingSameChannel = [];
    } finally {
      this.processing = false;
      this.activeChannel = null;
      process.stderr.write(`[kern:queue] done, remaining=${this.queue.length}\n`);
      this.processNext();
    }
  }
}
