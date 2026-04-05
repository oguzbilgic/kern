# Media

kern supports images and files in conversations across all interfaces.

## How it works

1. **Receive** — user sends an image/file via Telegram, Slack, or Web UI
2. **Store** — file saved to `.kern/media/` with a SHA-256 content-addressed filename (deduped)
3. **Message** — SDK-native content array stored in session with `kern-media://` URI references
4. **Digest** — before model call, images are described by a vision model and replaced with text (configurable)
5. **Serve** — `GET /media/:filename` serves stored files with immutable caching

## Storage

Media files live in `.kern/media/` (gitignored). Filenames are `{sha256-prefix}{ext}` — e.g. `a1b2c3d4e5f6g7h8.jpg`. This deduplicates identical files automatically.

A per-session sidecar file (`.media.jsonl`) tracks metadata: original filename, MIME type, size, timestamp, and cached image descriptions. This is also mirrored to the SQLite `media` table for cross-session queries.

## Pre-digest

When `mediaDigest` is enabled (default), kern automatically describes images before sending them to the chat model:

- A vision model generates a ~300 token description of each image
- The description replaces the image in the prompt: `[Image: A terminal showing npm install output...]`
- Descriptions are cached in the media sidecar — same image is only described once
- If `mediaModel` changes, stale descriptions are regenerated

This means:
- **Text-only models work** — they see descriptions, not raw images
- **Token costs are lower** — one vision call per image vs full image tokens every turn
- **Context is preserved** — text descriptions survive context trimming and appear in summaries

### Disabling pre-digest

Set `mediaDigest: false` in `.kern/config.json` to send raw images inline. This requires a vision-capable chat model but provides full image fidelity.

## Configuration

| Field | Default | Description |
|-------|---------|-------------|
| `mediaDigest` | `true` | Pre-digest images to text descriptions |
| `mediaModel` | `""` | Vision model for descriptions. Empty = use main model |

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

## Interfaces

- **Telegram** — photos, documents, stickers, voice, video, audio. Per-type error handling. 50MB limit.
- **Slack** — files shared in messages. 50MB limit.
- **Web UI** — drag-and-drop or file picker. Inline preview before send. Images rendered inline in chat history.

## API

- `GET /media/:filename` — serve a stored media file (requires auth)
- Media URLs in web UI use the proxy: `/api/agents/{agent}/media/{file}?token=AUTH`
