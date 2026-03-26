import type { StreamEvent } from "./runtime.js";

export interface QueuedMessage {
  text: string;
  userId: string;
  interface: string;
  channel: string;
  resolve: (response: string) => void;
  reject: (error: Error) => void;
  onEvent?: (event: StreamEvent) => void;
  isHeartbeat?: boolean;
}

import { log } from "./log.js";

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

  enqueue(msg: Omit<QueuedMessage, "resolve" | "reject">, onEvent?: (event: StreamEvent) => void): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const queued: QueuedMessage = { ...msg, resolve, reject, onEvent };

      // If we're processing and this is same channel (not heartbeat), store as pending injection
      if (this.processing && !msg.isHeartbeat && this.activeChannel && msg.channel === this.activeChannel) {
        this.pendingSameChannel.push(queued);
        log("queue", `same-channel injection queued (${msg.channel})`);
        return;
      }

      this.queue.push(queued);
      log("queue", `enqueued (${msg.interface}:${msg.channel || "?"}) depth=${this.queue.length} processing=${this.processing}`);
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

    log("queue", `processing (${msg.interface}:${msg.channel || "?"}) remaining=${this.queue.length}`);

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
      log("queue", `error: ${error.message}`);
      msg.reject(error);
      for (const pending of this.pendingSameChannel) {
        pending.reject(error);
      }
      this.pendingSameChannel = [];
    } finally {
      this.processing = false;
      this.activeChannel = null;
      log("queue", `done, remaining=${this.queue.length}`);
      this.processNext();
    }
  }
}
