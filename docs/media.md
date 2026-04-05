# Media

kern supports images and files in conversations across all interfaces.

## How it works

1. **Receive** — user sends an image/file via Telegram, Slack, or Web UI
2. **Store** — file saved to `.kern/media/` with a SHA-256 content-addressed filename (deduped)
3. **Digest** — images are described by a vision model at ingest time, cached permanently
4. **Message** — SDK-native content array stored in session with `kern-media://` URI references
5. **Context** — middleware replaces media refs with cached text descriptions before model call
6. **Serve** — `GET /media/:filename` serves stored files with immutable caching

## Storage

Media files live in `.kern/media/` (gitignored). Filenames are `{sha256-prefix}{ext}` — e.g. `a1b2c3d4e5f6g7h8.jpg`. This deduplicates identical files automatically.

A per-session sidecar file (`.media.jsonl`) tracks metadata: original filename, MIME type, size, timestamp, and cached descriptions. This is also mirrored to the SQLite `media` table for cross-session queries.

## Pre-digest

When `mediaDigest` is enabled (default), kern describes images once at ingest time:

- When a user sends an image, it's saved to disk and immediately described by a vision model (~300 tokens)
- The description is cached permanently in the media sidecar — never regenerated
- At model call time, middleware replaces image references with cached text: `[Image: photo.jpg (a1b2c3d4.jpg) — A terminal showing npm install output...]`
- On cache miss (e.g. old images from before digest was enabled), middleware triggers digest on the fly

This means:
- **Text-only models work** — they see descriptions, not raw images
- **Token costs are minimal** — one vision call per image, ever. No raw binary sent to model.
- **Context is preserved** — text descriptions survive context trimming and appear in summaries

### Disabling pre-digest

Set `mediaDigest: false` in `.kern/config.json` to skip digestion. Combined with `mediaContext` you can control what the model sees:

- `mediaDigest: false, mediaContext: 1` — raw images sent for the latest turn only, older get text placeholders
- `mediaDigest: false, mediaContext: 0` — no images sent to model at all, just `[attached image: hash.jpg]` placeholders

## Configuration

| Field | Default | Description |
|-------|---------|-------------|
| `mediaDigest` | `true` | Describe images at ingest time and replace with text in context |
| `mediaModel` | `""` | Vision model for descriptions. Empty = use main model |
| `mediaContext` | `0` | How many recent turns resolve raw media Buffers to the model. 0 = never send raw binary (descriptions or placeholders only) |

## Message format

Messages with media use SDK-native content arrays:

```json
{
  "role": "user",
  "content": [
    { "type": "image", "image": "kern-media://a1b2c3d4.jpg", "mediaType": "image/jpeg" },
    { "type": "text", "text": "What's in this screenshot?" }
  ]
}
```

For text extraction (embeddings, search, summaries), only text parts are used. Media references are preserved in session storage but don't pollute search indexes.

## Supported types

Images: JPEG, PNG, GIF, WebP, SVG, HEIC
Video: MP4, MOV, WebM
Audio: MP3, OGG, WAV, WebM, M4A
Documents: PDF, JSON, plain text, CSV, Markdown

Only images are pre-digested currently. Other file types pass through as-is (if `mediaContext > 0`) or become text placeholders (if `mediaContext: 0`).

## Interfaces

- **Telegram** — photos, documents, stickers, voice, video, audio. Per-type error handling. 50MB limit.
- **Slack** — files shared in messages. 50MB limit.
- **Web UI** — drag-and-drop or file picker. Inline preview before send. Images rendered inline in chat history.

## API

- `GET /media/:filename` — serve a stored media file (requires auth)
- Media URLs in web UI use the proxy: `/api/agents/{agent}/media/{file}?token=AUTH`
