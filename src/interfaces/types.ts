import type { ModelMessage } from "ai";
import type { StreamEvent } from "../runtime.js";

/** A media attachment on an incoming message. */
export interface Attachment {
  /** Content category. */
  type: "image" | "audio" | "video" | "document";
  /** Raw binary payload. */
  data: Buffer;
  /** MIME type (e.g. `image/png`). */
  mimeType: string;
  /** Original filename, if available. */
  filename?: string;
  /** Size in bytes. */
  size: number;
}

/**
 * The internal message object every interface passes into the runtime.
 *
 * This is Surface 2 of the metadata contract documented in
 * `docs/interfaces.md` § "Metadata contract".
 *
 * @see {@link https://github.com/oguzbilgic/kern-ai/blob/master/docs/interfaces.md#metadata-contract}
 */
export interface IncomingMessage {
  /** Message body text. */
  text: string;
  /** Platform-specific sender identifier (e.g. Telegram user ID, Slack user ID, Matrix mxid). */
  userId: string;
  /** Platform-specific conversation/room identifier (e.g. Telegram chat ID, Slack channel ID, Matrix room ID). */
  chatId: string;
  /** Interface name: `telegram`, `slack`, `matrix`, `web`, or `tui`. */
  interface: string;
  /** Human-readable channel label used in the agent-facing text prefix and SSE broadcast events. */
  channel?: string;
  /** Media files attached to the message. */
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
