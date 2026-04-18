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
 * The internal message object adapter interfaces (telegram, slack, matrix, cli)
 * pass into the runtime via their `onMessage` callback.
 *
 * HTTP clients (web UI, TUI) POST to `/message` with a flat JSON payload and
 * do not construct this object — see Surface 2 in `docs/interfaces.md`.
 *
 * @see docs/interfaces.md#metadata-contract
 */
export interface IncomingMessage {
  /** Message body text. */
  text: string;
  /** Platform-specific sender identifier (e.g. Telegram user ID, Slack user ID, Matrix mxid). */
  userId: string;
  /** Platform-specific conversation/room identifier (e.g. Telegram chat ID, Slack channel ID, Matrix room ID). */
  chatId: string;
  /** Interface name (for example: `telegram`, `slack`, `matrix`, `cli`, `web`, `tui`, or `system`). */
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
