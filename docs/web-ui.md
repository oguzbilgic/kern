# Web UI

The browser-based chat client served by `kern web`. See [Interfaces](interfaces.md#web-ui) for setup and architecture.

## Chat

- **Streaming responses** with live cursor and server-driven thinking indicator
- **Mid-turn messaging** — input stays enabled while agent is working. Messages are injected between tool steps.
- **Full history** on connect, including tool call results
- **Slash commands** — `/status`, `/restart`, `/help` with autocomplete popup
- **Markdown rendering** — headers, lists, code blocks, tables, bold, italic, links
- **Syntax highlighting** — code blocks in tool output and assistant messages
- Dark theme, mobile-friendly

## Tool output

- **Collapsible** — click a tool call to expand and see the full result
- **Edit diffs** — inline red/green diff for edit tool calls
- **Bash formatting** — command chains broken at separators with syntax highlighting
- **Fullscreen expand** — button appears on scrollable tool output blocks

## Sidebar

- Agents grouped by server with online/offline status dots
- Drag right edge to resize: full → mini (avatars only) → collapsed
- Hamburger button toggles collapsed ↔ previous state
- Small windows force mini mode (no overlay)
- Add remote servers with URL + token
- Logout button clears auth token

## Agent info

Click the agent name in the header to see:

- Model and provider
- Uptime
- Session message and token counts
- Context window token breakdown
- Cache hit rate
- Active tool scope

## Memory UI

Unified overlay accessible from the toolbar with 5 tabs:

- **Sessions** — session list with activity charts
- **Segments** — semantic segment hierarchy with summaries, compression stats, and context filter
- **Notes** — daily note summaries with regeneration
- **Recall** — semantic search over past conversations with stats
- **Context** — structured view of the full prompt sent to the model, with token breakdown per section

## Messages

Color-coded by source:

| Source | Color |
|--------|-------|
| Your messages | blue |
| Incoming (Telegram, Slack) | yellow |
| Outgoing (agent → other channels) | green |
| Heartbeat | magenta |
| Tool calls | per-tool colors |

## Media

- Drag-and-drop or click to attach images and files
- Inline image preview in message bubbles
- Attachment thumbnails in input area before sending
