import React, { useState, useEffect } from "react";
import { render, Box, Text, Static, useInput, useApp, useStdout } from "ink";
// @ts-ignore
import Spinner from "ink-spinner";
import type { ServerEvent } from "./server.js";

// --- Types ---

interface ChatMessage {
  type: "user" | "assistant" | "incoming" | "outgoing" | "heartbeat" | "tool" | "error" | "gap";
  text: string;
  meta?: string;
}

interface TuiProps {
  port: number;
  agentName: string;
  version: string;
}

// --- Helpers ---

const TOOL_COLORS: Record<string, string> = {
  bash: "red", read: "cyan", write: "green", edit: "yellow",
  glob: "magenta", grep: "blue", webfetch: "cyan", kern: "white", message: "green",
};

function parseUserMessage(content: string): ChatMessage {
  const match = content.match(/^\[via ([^,]+),?\s*([^,]*),?\s*user:\s*([^,\]]*),?\s*(?:time:\s*([^\]]*))?\]\n?([\s\S]*)$/);
  if (match) {
    const [, iface, channel, userId, , text] = match;
    const cleanText = text.trim();
    if (iface.trim() === "tui") return { type: "user", text: cleanText || "(empty)" };
    if (iface.trim() === "system" && channel?.trim() === "heartbeat") return { type: "heartbeat", text: "" };
    return { type: "incoming", text: cleanText || "(empty)", meta: `[${iface.trim()} ${userId.trim()}]` };
  }
  if (content === "[heartbeat]") return { type: "heartbeat", text: "" };
  return { type: "user", text: content };
}

function convertHistory(history: any[]): ChatMessage[] {
  const raw: ChatMessage[] = [];
  for (const m of history) {
    if (m.role === "user" && typeof m.content === "string") {
      raw.push(parseUserMessage(m.content));
    } else if (m.role === "assistant") {
      if (Array.isArray(m.content)) {
        for (const p of m.content) {
          if (p.type === "tool-call") {
            const input = p.input || {};
            const detail = input.path || input.command || input.pattern || input.url || input.action || input.userId || "";
            raw.push({ type: "tool", text: `${p.toolName} ${detail}` });
          }
        }
        const text = m.content.filter((p: any) => p.type === "text").map((p: any) => p.text).join("");
        if (text && text !== "NO_REPLY" && text !== "(no text response)") {
          raw.push({ type: "assistant", text });
        }
      } else if (typeof m.content === "string" && m.content !== "NO_REPLY" && m.content !== "(no text response)") {
        raw.push({ type: "assistant", text: m.content });
      }
    }
  }
  // Insert gaps between blocks
  return addGaps(raw);
}

function addGaps(msgs: ChatMessage[]): ChatMessage[] {
  if (msgs.length === 0) return msgs;
  // Remove existing gaps first (prevents stacking)
  const clean = msgs.filter(m => m.type !== "gap");
  if (clean.length === 0) return clean;
  const result: ChatMessage[] = [clean[0]];
  for (let i = 1; i < clean.length; i++) {
    const prev = clean[i - 1].type;
    const curr = clean[i].type;
    // Gap only before: first tool after non-tool, assistant after tool
    const isFirstTool = curr === "tool" && prev !== "tool";
    const isAssistantAfterTool = curr === "assistant" && prev === "tool";
    if (isFirstTool || isAssistantAfterTool) {
      result.push({ type: "gap", text: "" });
    }
    result.push(clean[i]);
  }
  return result;
}

// --- Components ---

function InputBox({ input, busy, version, agentName, model, width }: {
  input: string; busy: boolean; version: string; agentName: string; model: string; width: number;
}) {
  const iw = width - 3;
  const empty = " ".repeat(iw);
  const cursor = busy ? "" : "▎";
  const inputLine = ("  " + input + cursor).padEnd(iw);
  const statusLine = ("  kern v" + version + " · " + agentName + (model ? " · " + model : "")).padEnd(iw);
  return (
    <Box borderStyle="bold" borderLeft={true} borderRight={false} borderTop={false} borderBottom={false} borderColor="green" width={width}>
      <Box flexDirection="column" width={iw}>
        <Text backgroundColor="#1a1a1a" color="white">{empty}</Text>
        <Text backgroundColor="#1a1a1a" color="white">{inputLine}</Text>
        <Text backgroundColor="#1a1a1a" color="white">{empty}</Text>
        <Text backgroundColor="#1a1a1a" dimColor italic>{statusLine}</Text>
        <Text backgroundColor="#1a1a1a" color="white">{empty}</Text>
      </Box>
    </Box>
  );
}

function MsgBox({ text, borderColor, width, label }: {
  text: string; borderColor: string; width: number; label?: string;
}) {
  const iw = width - 3;
  const empty = " ".repeat(iw);
  return (
    <Box borderStyle="bold" borderLeft={true} borderRight={false} borderTop={false} borderBottom={false} borderColor={borderColor} width={width}>
      <Box flexDirection="column" width={iw}>
        <Text backgroundColor="#1a1a1a" color="white">{empty}</Text>
        {label && <Text backgroundColor="#1a1a1a" dimColor>{("  " + label).padEnd(iw)}</Text>}
        <Text backgroundColor="#1a1a1a" color="white" wrap="wrap">{("  " + text).padEnd(iw)}</Text>
        <Text backgroundColor="#1a1a1a" color="white">{empty}</Text>
      </Box>
    </Box>
  );
}

function MessageView({ msg, width }: { msg: ChatMessage; width: number }) {
  switch (msg.type) {
    case "gap":
      return <Text>{" "}</Text>;
    case "user":
      return <MsgBox text={msg.text} borderColor="green" width={width} />;
    case "incoming":
      return <MsgBox text={msg.text} borderColor="yellow" width={width} label={msg.meta} />;
    case "outgoing":
      return <MsgBox text={msg.text} borderColor="green" width={width} label={msg.meta} />;
    case "heartbeat":
      return (
        <Box borderStyle="bold" borderLeft={true} borderRight={false} borderTop={false} borderBottom={false} borderColor="magenta" width={width}>
          <Box flexDirection="column" width={width - 3}>
            <Text backgroundColor="#1a1a1a" dimColor>{" ".repeat(width - 3)}</Text>
            <Text backgroundColor="#1a1a1a" color="magenta">{("  ♡ heartbeat").padEnd(width - 3)}</Text>
            <Text backgroundColor="#1a1a1a" dimColor>{" ".repeat(width - 3)}</Text>
          </Box>
        </Box>
      );
    case "assistant":
      return (
        <Box paddingLeft={3}>
          <Text color="white" wrap="wrap">{msg.text}</Text>
        </Box>
      );
    case "tool": {
      const spaceIdx = msg.text.indexOf(" ");
      const toolName = spaceIdx > 0 ? msg.text.slice(0, spaceIdx) : msg.text;
      const toolDetail = spaceIdx > 0 ? msg.text.slice(spaceIdx) : "";
      const color = TOOL_COLORS[toolName] || "yellow";
      return (
        <Box paddingLeft={3}>
          <Text color={color} bold={toolName === "kern"}>{toolName}</Text>
          <Text dimColor>{toolDetail}</Text>
        </Box>
      );
    }
    case "error":
      return <Box paddingLeft={3}><Text color="red">{msg.text}</Text></Box>;
    default:
      return <Text>{msg.text}</Text>;
  }
}

// --- App ---

function App({ port, agentName, version }: TuiProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [oldestIndex, setOldestIndex] = useState<number | null>(null);
  const [model, setModel] = useState("");
  const baseUrl = `http://127.0.0.1:${port}`;
  const cols = stdout?.columns || 80;

  // Load history + status
  useEffect(() => {
    (async () => {
      try {
        const s = await (await fetch(`${baseUrl}/status`)).json();
        if (s.model) setModel(s.model);
      } catch {}
      try {
        const h = await (await fetch(`${baseUrl}/history?limit=30`)).json();
        if (h.length > 0) {
          setMessages(convertHistory(h));
          if (h[0]?.index !== undefined) setOldestIndex(h[0].index);
        }
      } catch {}
    })();
  }, []);

  // SSE
  useEffect(() => {
    let aborted = false;
    function handle(event: ServerEvent) {
      if ((event as any).type === "incoming" && event.fromInterface !== "tui") {
        setMessages((m: ChatMessage[]) => addGaps([...m, {
          type: "incoming", text: event.text || "",
          meta: `[${event.fromInterface} ${event.fromUserId || ""}]`,
        }]));
        return;
      }
      if ((event as any).type === "outgoing") {
        setMessages((m: ChatMessage[]) => addGaps([...m, {
          type: "outgoing", text: event.text || "",
          meta: `[→ ${event.fromInterface} ${event.fromUserId || ""}]`,
        }]));
        return;
      }
      if ((event as any).type === "heartbeat") {
        setMessages((m: ChatMessage[]) => addGaps([...m, { type: "heartbeat", text: "" }]));
        return;
      }
      switch (event.type) {
        case "text-delta":
          setStreamingText((s: string) => s + (event.text || ""));
          setBusy(true);
          break;
        case "tool-call": {
          const detail = event.toolDetail ? ` ${event.toolDetail}` : "";
          setMessages((m: ChatMessage[]) => addGaps([...m, { type: "tool", text: `${event.toolName}${detail}` }]));
          setBusy(true);
          break;
        }
        case "finish":
          setStreamingText((s: string) => {
            if (s) setMessages((m: ChatMessage[]) => addGaps([...m, { type: "assistant", text: s }]));
            return "";
          });
          setBusy(false);
          break;
        case "error":
          setMessages((m: ChatMessage[]) => addGaps([...m, { type: "error", text: event.error || "Unknown error" }]));
          setStreamingText("");
          setBusy(false);
          break;
      }
    }
    async function connect() {
      try {
        const res = await fetch(`${baseUrl}/events`);
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try { handle(JSON.parse(line.slice(6))); } catch {}
          }
        }
      } catch {
        if (!aborted) setTimeout(connect, 2000);
      }
    }
    connect();
    return () => { aborted = true; };
  }, []);

  // Input
  useInput((ch: string, key: any) => {
    if (key.escape) { exit(); return; }
    if (key.return && input.trim() && !busy) {
      const text = input.trim();
      setInput("");
      setMessages((m: ChatMessage[]) => addGaps([...m, { type: "user", text }]));
      setBusy(true);
      fetch(`${baseUrl}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, userId: "tui", interface: "tui", channel: "tui" }),
      }).catch(() => {
        setMessages((m: ChatMessage[]) => [...m, { type: "error", text: "Connection error" }]);
        setBusy(false);
      });
      return;
    }
    if (key.backspace || key.delete) { setInput((s: string) => s.slice(0, -1)); return; }
    if (ch && !key.ctrl && !key.meta) { setInput((s: string) => s + ch); }
  });

  return (
    <Box flexDirection="column">
      <Static items={messages.map((msg, i) => ({ id: String(i), msg }))}>
        {({ id, msg }) => <MessageView key={id} msg={msg} width={cols} />}
      </Static>

      <Box flexDirection="column">
        {streamingText && (
          <Box paddingLeft={3}><Text color="white" wrap="wrap">{streamingText}</Text></Box>
        )}
        {busy && !streamingText && (
          <Box paddingLeft={3}>
            {/* @ts-ignore */}
            <Text color="blue"><Spinner type="dots" /></Text>
            <Text dimColor> thinking...</Text>
          </Box>
        )}
        <Box marginTop={1}>
          <InputBox input={input} busy={busy} version={version} agentName={agentName} model={model} width={cols} />
        </Box>
      </Box>
    </Box>
  );
}

// --- Entry ---

export async function connectTuiV2(port: number, agentName: string): Promise<void> {
  let model = "";
  try {
    const res = await fetch(`http://127.0.0.1:${port}/status`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const status = await res.json();
    model = status.model || "";
  } catch {
    console.error(`Cannot connect to ${agentName} on port ${port}`);
    process.exit(1);
  }

  let version = "?";
  try {
    const { readFile } = await import("fs/promises");
    const { join } = await import("path");
    const pkg = JSON.parse(await readFile(join(import.meta.dirname, "..", "package.json"), "utf-8"));
    version = pkg.version;
  } catch {}

  const { waitUntilExit } = render(
    <App port={port} agentName={agentName} version={version} />,
    { exitOnCtrlC: true }
  );
  await waitUntilExit();

  process.stdout.write("\x1b[2J\x1b[H");
  const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
  const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
  process.stdout.write(`\n  ${bold("kern")} ${dim("v" + version)} · ${agentName}${model ? " · " + model : ""} · ${dim("running")}\n\n`);
  process.exit(0);
}
