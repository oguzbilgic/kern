import { createHash } from "crypto";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join, extname } from "path";
import { log } from "./log.js";

/** Reference stored in session/messages instead of raw buffer */
export interface MediaRef {
  type: "image" | "audio" | "video" | "document";
  path: string;       // relative to agentDir, e.g. ".kern/media/abc123.jpg"
  mimeType: string;
  filename?: string;
  size: number;
}

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
  // Try filename extension first
  if (filename) {
    const ext = extname(filename);
    if (ext) return ext;
  }
  return MIME_TO_EXT[mimeType] || ".bin";
}

/**
 * Save a media buffer to .kern/media/ and return a reference.
 * Files are content-addressed by SHA-256 hash — identical files are deduplicated.
 */
export function saveMedia(
  agentDir: string,
  data: Buffer,
  type: MediaRef["type"],
  mimeType: string,
  filename?: string,
): MediaRef {
  const mediaDir = join(agentDir, ".kern", "media");
  if (!existsSync(mediaDir)) {
    mkdirSync(mediaDir, { recursive: true });
  }

  const hash = createHash("sha256").update(data).digest("hex").slice(0, 16);
  const ext = getExtension(mimeType, filename);
  const storedName = `${hash}${ext}`;
  const fullPath = join(mediaDir, storedName);
  const relativePath = `.kern/media/${storedName}`;

  if (!existsSync(fullPath)) {
    writeFileSync(fullPath, data);
    log("media", `saved ${storedName} (${data.length} bytes, ${mimeType})`);
  } else {
    log("media", `dedup hit: ${storedName}`);
  }

  return {
    type,
    path: relativePath,
    mimeType,
    filename,
    size: data.length,
  };
}

/**
 * Load media data from disk given a MediaRef.
 * Returns the buffer, or null if file is missing.
 */
export function loadMedia(agentDir: string, ref: MediaRef): Buffer | null {
  const fullPath = join(agentDir, ref.path);
  if (!existsSync(fullPath)) {
    log.warn("media", `file not found: ${ref.path}`);
    return null;
  }
  return readFileSync(fullPath);
}
