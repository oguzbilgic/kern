import { createHash } from "crypto";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join, extname } from "path";
import { log } from "./log.js";
import type { ModelMessage, UserContent } from "ai";

/** URI scheme for media references stored on disk */
export const MEDIA_SCHEME = "kern-media://";

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "image/heic": ".heic",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
  "audio/mpeg": ".mp3",
  "audio/ogg": ".ogg",
  "audio/wav": ".wav",
  "audio/webm": ".webm",
  "audio/mp4": ".m4a",
  "application/pdf": ".pdf",
  "application/json": ".json",
  "text/plain": ".txt",
  "text/csv": ".csv",
  "text/markdown": ".md",
};

function getExtension(mimeType: string, filename?: string): string {
  if (filename) {
    const ext = extname(filename);
    if (ext) return ext;
  }
  return MIME_TO_EXT[mimeType] || ".bin";
}

/**
 * Save media buffer to .kern/media/ with content-addressed filename.
 * Returns the kern-media:// URI for storage in messages.
 */
export function saveMedia(
  agentDir: string,
  data: Buffer,
  mimeType: string,
  filename?: string,
): { uri: string; mimeType: string; filename?: string; size: number } {
  const mediaDir = join(agentDir, ".kern", "media");
  if (!existsSync(mediaDir)) {
    mkdirSync(mediaDir, { recursive: true });
  }

  const hash = createHash("sha256").update(data).digest("hex").slice(0, 16);
  const ext = getExtension(mimeType, filename);
  const storedName = `${hash}${ext}`;
  const fullPath = join(mediaDir, storedName);

  if (!existsSync(fullPath)) {
    writeFileSync(fullPath, data);
    log("media", `saved ${storedName} (${data.length} bytes, ${mimeType})`);
  } else {
    log("media", `dedup hit: ${storedName}`);
  }

  return {
    uri: `${MEDIA_SCHEME}${storedName}`,
    mimeType,
    filename,
    size: data.length,
  };
}

/**
 * Build SDK-native content array from text + saved media refs.
 * Returns a string if no media, or UserContent array if media present.
 */
export function buildUserContent(
  text: string,
  media: { uri: string; mimeType: string; filename?: string }[],
): UserContent {
  if (media.length === 0) return text;

  const parts: any[] = [];

  for (const m of media) {
    if (m.mimeType.startsWith("image/")) {
      parts.push({ type: "image", image: m.uri, mediaType: m.mimeType });
    } else {
      parts.push({
        type: "file",
        data: m.uri,
        mediaType: m.mimeType,
        ...(m.filename ? { filename: m.filename } : {}),
      });
    }
  }

  if (text) {
    parts.push({ type: "text", text });
  }

  return parts;
}

/**
 * Resolve kern-media:// references in messages to Buffers for model calls.
 * Only resolves the last `limit` user messages with media (older ones get text placeholders).
 */
export function resolveMediaRefs(
  agentDir: string,
  messages: ModelMessage[],
  limit: number = 10,
): ModelMessage[] {
  const mediaDir = join(agentDir, ".kern", "media");

  // Find user messages with array content (media), count from end
  const mediaIndices: number[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === "user" && Array.isArray(msg.content)) {
      const hasMedia = (msg.content as any[]).some(
        (p) => p.type === "image" || p.type === "file",
      );
      if (hasMedia) mediaIndices.push(i);
    }
  }

  const resolveSet = new Set(mediaIndices.slice(0, limit));

  return messages.map((msg, idx) => {
    if (msg.role !== "user" || !Array.isArray(msg.content)) return msg;

    const parts = msg.content as any[];
    const hasMediaRefs = parts.some(
      (p) =>
        (p.type === "image" && typeof p.image === "string" && p.image.startsWith(MEDIA_SCHEME)) ||
        (p.type === "file" && typeof p.data === "string" && p.data.startsWith(MEDIA_SCHEME)),
    );
    if (!hasMediaRefs) return msg;

    if (resolveSet.has(idx)) {
      // Resolve to Buffers
      const resolved = parts.map((p) => {
        if (p.type === "image" && typeof p.image === "string" && p.image.startsWith(MEDIA_SCHEME)) {
          const file = p.image.slice(MEDIA_SCHEME.length);
          const fullPath = join(mediaDir, file);
          if (existsSync(fullPath)) {
            return { ...p, image: readFileSync(fullPath) };
          }
          log.warn("media", `file not found: ${file}`);
          return { type: "text", text: `[image unavailable: ${file}]` };
        }
        if (p.type === "file" && typeof p.data === "string" && p.data.startsWith(MEDIA_SCHEME)) {
          const file = p.data.slice(MEDIA_SCHEME.length);
          const fullPath = join(mediaDir, file);
          if (existsSync(fullPath)) {
            return { ...p, data: readFileSync(fullPath) };
          }
          log.warn("media", `file not found: ${file}`);
          return { type: "text", text: `[file unavailable: ${file}]` };
        }
        return p;
      });
      return { ...msg, content: resolved };
    } else {
      // Too old — replace media with text placeholders
      const simplified = parts.map((p) => {
        if (p.type === "image") {
          const file = typeof p.image === "string" ? p.image.replace(MEDIA_SCHEME, "") : "image";
          return { type: "text", text: `[attached image: ${file}]` };
        }
        if (p.type === "file") {
          const name = p.filename || (typeof p.data === "string" ? p.data.replace(MEDIA_SCHEME, "") : "file");
          return { type: "text", text: `[attached file: ${name}]` };
        }
        return p;
      });
      // Collapse to string if only text parts remain
      const textOnly = simplified.filter((p: any) => p.type === "text").map((p: any) => p.text).join("\n");
      return { ...msg, content: textOnly };
    }
  });
}

/**
 * Extract plain text from message content (string or array).
 * Used for embeddings, search, summaries — strips media parts.
 */
export function extractText(content: string | any[] | any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p.type === "text" && p.text)
      .map((p) => p.text)
      .join("\n");
  }
  return String(content ?? "");
}
