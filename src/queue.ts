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

  // Resolve drained injections with NO_REPLY — they were folded into the
  // active turn's response, so their interface handlers must stay quiet.
  // Requeue still-pending same-channel messages — they arrived mid-turn but
  // were never drained (e.g. single-step turn with no prepareStep calls), so
  // they need to run as their own turn instead of being silently dropped.
  private finalizePendingSameChannel() {
    for (const drained of this.drainedSameChannel) {
      drained.resolve("NO_REPLY");
    }
    this.drainedSameChannel = [];

    const requeue = this.pendingSameChannel;
    this.pendingSameChannel = [];
    for (const msg of requeue) {
      this.queue.push(msg);
      log("queue", `requeued same-channel message (${msg.interface}:${msg.channel || "?"})`);
    }
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
      this.finalizePendingSameChannel();
    } catch (error: any) {
      log.error("queue", `error: ${error.message}`);
      msg.reject(error);
      // Errors belong to the active message. Drained injections were already
      // folded into the (failed) turn, so NO_REPLY them. Still-pending
      // messages were never touched — requeue them for their own turn.
      this.finalizePendingSameChannel();
    } finally {
      this.processing = false;
      this.activeChannel = null;
      log("queue", `done, remaining=${this.queue.length}`);
      this.processNext();
    }
  }
}
