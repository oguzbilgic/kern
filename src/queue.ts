import type { StreamEvent } from "./runtime.js";
import type { Attachment } from "./interfaces/types.js";

export interface QueuedMessage {
  text: string;
  userId: string;
  interface: string;
  channel: string;
  resolve: (response: string) => void;
  reject: (error: Error) => void;
  onEvent?: (event: StreamEvent) => void;
  isHeartbeat?: boolean;
  attachments?: Attachment[];
}

import { log } from "./log.js";

export class MessageQueue {
  private queue: QueuedMessage[] = [];
  private processing = false;
  private activeChannel: string | null = null;
  // Same-channel messages that arrived mid-turn, waiting to be drained into
  // the active turn via prepareStep.
  private pendingSameChannel: QueuedMessage[] = [];
  // Same-channel messages already drained into the active turn. Kept around
  // so we can resolve their Promises with NO_REPLY when the turn finishes —
  // otherwise the interface handlers that awaited onMessage() would hang.
  private drainedSameChannel: QueuedMessage[] = [];
  private handler: ((msg: QueuedMessage, pendingMessages: () => QueuedMessage[]) => Promise<string>) | null = null;
  private timeoutMs = 5 * 60 * 1000; // 5 minute timeout per message

  setHandler(fn: (msg: QueuedMessage, pendingMessages: () => QueuedMessage[]) => Promise<string>) {
    this.handler = fn;
  }

  getActiveChannel(): string | null {
    return this.activeChannel;
  }

  getStatus(): { processing: boolean; pending: number; activeChannel: string | null } {
    return {
      processing: this.processing,
      pending: this.queue.length,
      activeChannel: this.activeChannel,
    };
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

  // Called by prepareStep to get pending same-channel messages.
  // Drained messages are moved to `drainedSameChannel` so their Promises
  // can still be resolved when the active turn finishes.
  drainPendingSameChannel(): QueuedMessage[] {
    const pending = [...this.pendingSameChannel];
    this.pendingSameChannel = [];
    this.drainedSameChannel.push(...pending);
    return pending;
  }

  private resolvePendingWithNoReply() {
    for (const pending of this.pendingSameChannel) {
      pending.resolve("NO_REPLY");
    }
    for (const drained of this.drainedSameChannel) {
      drained.resolve("NO_REPLY");
    }
    this.pendingSameChannel = [];
    this.drainedSameChannel = [];
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

      // Same-channel injections — both still-pending and already-drained —
      // are folded into the active turn's response. Resolve them with
      // NO_REPLY so their interface handlers don't post the same reply again.
      // Draining into `drainedSameChannel` during the turn is what lets
      // multi-step turns still resolve these Promises at the end.
      this.resolvePendingWithNoReply();
    } catch (error: any) {
      log.error("queue", `error: ${error.message}`);
      msg.reject(error);
      // Errors belong to the active message, not the injected ones.
      this.resolvePendingWithNoReply();
    } finally {
      this.processing = false;
      this.activeChannel = null;
      log("queue", `done, remaining=${this.queue.length}`);
      this.processNext();
    }
  }
}
