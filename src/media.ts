import { createHash } from "crypto";
import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from "fs";
import { join, extname } from "path";
import { generateText, wrapLanguageModel, type LanguageModelMiddleware, type ModelMessage, type UserContent } from "ai";
import { log } from "./log.js";
import { createModel } from "./model.js";
import type { KernConfig } from "./config.js";
import type { MemoryDB } from "./memory.js";

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

// --- Media entry type ---

export interface MediaEntry {
  file: string;
  originalName?: string;
  mimeType: string;
  size: number;
  description?: string;
  describedBy?: string;
  timestamp: string;
}

// --- Media sidecar ---

export class MediaSidecar {
  private map = new Map<string, MediaEntry>();
  private sidecarPath: string;
  private sessionId: string;
  private memoryDB: MemoryDB | null;

  constructor(sessionsDir: string, sessionId: string, memoryDB: MemoryDB | null = null) {
    this.sidecarPath = join(sessionsDir, `${sessionId}.media.jsonl`);
    this.sessionId = sessionId;
    this.memoryDB = memoryDB;
  }

  /** Load sidecar from disk into memory map. Last entry per file wins. */
  load(): void {
    if (!existsSync(this.sidecarPath)) return;
    try {
      const raw = readFileSync(this.sidecarPath, "utf-8");
      for (const line of raw.split("\n")) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line) as MediaEntry;
          if (entry.file) this.map.set(entry.file, entry);
        } catch {
          // Skip malformed lines
        }
      }
      log("media", `loaded sidecar: ${this.map.size} entries`);
    } catch (err) {
      log.warn("media", `failed to load sidecar: ${err}`);
    }
  }

  /** Append a media entry to the sidecar file and SQLite. */
  append(entry: MediaEntry): void {
    this.map.set(entry.file, entry);
    try {
      appendFileSync(this.sidecarPath, JSON.stringify(entry) + "\n");
    } catch (err) {
      log.warn("media", `failed to write sidecar: ${err}`);
    }
    // Mirror to SQLite
    if (this.memoryDB) {
      try {
        this.memoryDB.db.prepare(`
          INSERT INTO media (session_id, file, originalName, mimeType, size, description, describedBy, timestamp)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(session_id, file) DO UPDATE SET
            description = excluded.description,
            describedBy = excluded.describedBy,
            originalName = excluded.originalName
        `).run(
          this.sessionId,
          entry.file,
          entry.originalName || null,
          entry.mimeType,
          entry.size,
          entry.description || null,
          entry.describedBy || null,
          entry.timestamp,
        );
      } catch (err) {
        log.warn("media", `failed to write media to SQLite: ${err}`);
      }
    }
  }

  /** Get a media entry by filename. */
  get(filename: string): MediaEntry | undefined {
    return this.map.get(filename);
  }

  /** Get cached description if it exists and was made by the current model. */
  getDescription(filename: string, currentModel?: string): string | null {
    const entry = this.map.get(filename);
    if (!entry?.description) return null;
    // If model changed, description is stale
    if (currentModel && entry.describedBy && entry.describedBy !== currentModel) return null;
    return entry.description;
  }

  /** Update an existing entry with a description. */
  updateDescription(filename: string, description: string, describedBy: string): void {
    const existing = this.map.get(filename);
    if (existing) {
      const updated = { ...existing, description, describedBy };
      this.append(updated);
    }
  }

  get size(): number {
    return this.map.size;
  }
}

// --- Save media to disk ---

/**
 * Save media buffer to .kern/media/ with content-addressed filename.
 * Returns the kern-media:// URI for storage in messages.
 */
export function saveMedia(
  agentDir: string,
  data: Buffer,
  mimeType: string,
  filename?: string,
): { uri: string; file: string; mimeType: string; filename?: string; size: number } {
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
    file: storedName,
    mimeType,
    filename,
    size: data.length,
  };
}

// --- Build user content ---

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

// --- Resolve media refs ---

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

// --- Extract text ---

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

// --- Media digest middleware ---

/**
 * Extract filename from a provider-level file part's data field.
 * At middleware level, SDK converts ImagePart → FilePart with data as Buffer/URL/string.
 * We need to match back to our kern-media:// filename for sidecar lookup.
 *
 * The data at this point is already a resolved Buffer (from resolveMediaRefs).
 * We can't extract the filename from it. Instead we track a mapping from
 * content hash → filename built during resolveMediaRefs.
 */

/** Map from buffer content hash to kern-media filename, populated during resolution. */
const bufferToFilename = new Map<string, string>();

/**
 * Enhanced resolveMediaRefs that also populates the buffer→filename mapping
 * so the digest middleware can look up sidecar entries.
 */
export function resolveMediaRefsTracked(
  agentDir: string,
  messages: ModelMessage[],
  limit: number = 10,
): ModelMessage[] {
  bufferToFilename.clear();
  const mediaDir = join(agentDir, ".kern", "media");

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
      const resolved = parts.map((p) => {
        if (p.type === "image" && typeof p.image === "string" && p.image.startsWith(MEDIA_SCHEME)) {
          const file = p.image.slice(MEDIA_SCHEME.length);
          const fullPath = join(mediaDir, file);
          if (existsSync(fullPath)) {
            const buf = readFileSync(fullPath);
            // Track: hash the buffer so middleware can find the filename
            const hash = createHash("sha256").update(buf).digest("hex");
            bufferToFilename.set(hash, file);
            return { ...p, image: buf };
          }
          log.warn("media", `file not found: ${file}`);
          return { type: "text", text: `[image unavailable: ${file}]` };
        }
        if (p.type === "file" && typeof p.data === "string" && p.data.startsWith(MEDIA_SCHEME)) {
          const file = p.data.slice(MEDIA_SCHEME.length);
          const fullPath = join(mediaDir, file);
          if (existsSync(fullPath)) {
            const buf = readFileSync(fullPath);
            const hash = createHash("sha256").update(buf).digest("hex");
            bufferToFilename.set(hash, file);
            return { ...p, data: buf };
          }
          log.warn("media", `file not found: ${file}`);
          return { type: "text", text: `[file unavailable: ${file}]` };
        }
        return p;
      });
      return { ...msg, content: resolved };
    } else {
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
      const textOnly = simplified.filter((p: any) => p.type === "text").map((p: any) => p.text).join("\n");
      return { ...msg, content: textOnly };
    }
  });
}

/** Hash a buffer or Uint8Array for lookup in bufferToFilename map. */
function hashData(data: unknown): string | null {
  if (data instanceof Buffer || data instanceof Uint8Array) {
    return createHash("sha256").update(data).digest("hex");
  }
  return null;
}

/**
 * Create middleware that replaces image Buffers with text descriptions.
 * Looks up cached descriptions in the sidecar; calls vision model on cache miss.
 */
export function createMediaDigestMiddleware(
  sidecar: MediaSidecar,
  config: KernConfig,
): LanguageModelMiddleware {
  const mediaModelId = config.mediaModel || config.model;

  return {
    specificationVersion: "v3",
    async transformParams({ params }) {
      const prompt = params.prompt;
      let digested = 0;

      const newPrompt = await Promise.all(
        prompt.map(async (msg) => {
          if (msg.role !== "user") return msg;

          const parts = msg.content;
          const newParts = await Promise.all(
            parts.map(async (part) => {
              // At middleware level, images become file parts with image/* mediaType
              if (part.type !== "file") return part;
              if (!part.mediaType?.startsWith("image/")) return part;

              // Find the filename via buffer hash
              const hash = hashData(part.data);
              const filename = hash ? bufferToFilename.get(hash) : null;
              if (!filename) {
                // Can't identify this media — pass through as-is
                log.debug("media", "digest: unknown buffer, passing through");
                return part;
              }

              // Check sidecar for cached description
              const cached = sidecar.getDescription(filename, mediaModelId);
              if (cached) {
                digested++;
                const entry = sidecar.get(filename);
                const label = entry?.originalName ? `${entry.originalName} (${filename})` : filename;
                return { type: "text" as const, text: `[Image: ${label} — ${cached}]` };
              }

              // Cache miss — call vision model
              try {
                log("media", `digesting ${filename} with ${mediaModelId}...`);
                const digestModel = createModel({
                  ...config,
                  model: mediaModelId,
                });

                const result = await generateText({
                  model: digestModel,
                  messages: [
                    {
                      role: "user",
                      content: [
                        { type: "image", image: part.data as any, mediaType: part.mediaType },
                        { type: "text", text: "Describe this image." },
                      ],
                    },
                  ],
                  maxOutputTokens: 300,
                });

                const description = result.text.trim();
                if (description) {
                  sidecar.updateDescription(filename, description, mediaModelId);
                  digested++;
                  const entry = sidecar.get(filename);
                  const label = entry?.originalName ? `${entry.originalName} (${filename})` : filename;
                  return { type: "text" as const, text: `[Image: ${label} — ${description}]` };
                }
              } catch (err) {
                log.warn("media", `digest failed for ${filename}: ${err}`);
              }

              // Fallback: pass image through as-is
              return part;
            }),
          );

          return { ...msg, content: newParts };
        }),
      );

      if (digested > 0) {
        log("media", `pre-digested ${digested} image(s)`);
      }

      return { ...params, prompt: newPrompt as any };
    },
  };
}

/**
 * Wrap a model with media digest middleware if enabled.
 * Returns the original model if digest is disabled.
 */
export function wrapWithMediaDigest(
  model: any,
  sidecar: MediaSidecar | null,
  config: KernConfig,
): any {
  if (!config.mediaDigest || !sidecar) return model;
  const middleware = createMediaDigestMiddleware(sidecar, config);
  return wrapLanguageModel({ model, middleware });
}
