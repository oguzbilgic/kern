import React, { useState, useEffect } from "react";
import { render, Box, Text, Static, useInput, useApp, useStdout } from "ink";
// @ts-ignore
import Spinner from "ink-spinner";
import type { ServerEvent } from "./server.js";

interface ChatMessage {
  type: "user" | "assistant" | "incoming" | "outgoing" | "heartbeat" | "tool" | "error";
  text: string;
  meta?: string;
}

interface TuiProps {
  port: number;
  agentName: string;
  version: string;
}

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
  const converted: ChatMessage[] = [];
  for (const m of history) {
    if (m.role === "user" && typeof m.content === "string") {
      converted.push(parseUserMessage(m.content));
    } else if (m.role === "assistant") {
      const text = typeof m.content === "string"
        ? m.content
        : Array.isArray(m.content)
          ? m.content.filter((p: any) => p.type === "text").map((p: any) => p.text).join("")
          : "";
      if (text && text !== "NO_REPLY" && text !== "(no text response)") {
        converted.push({ type: "assistant", text });
      }
    }
  }
  return converted;
}

function MessageView({ msg, width }: { msg: ChatMessage; width: number }) {
  const maxW = width - 4;
  switch (msg.type) {
    case "user":
      return <Box><Text color="green" bold>{">"} </Text><Text wrap="wrap">{msg.text}</Text></Box>;
    case "assistant":
      return <Box><Text color="blue">◆ </Text><Text wrap="wrap">{msg.text}</Text></Box>;
    case "incoming":
      return <Box><Text color="yellow">◇ </Text><Text dimColor>{msg.meta} </Text><Text wrap="wrap">{msg.text}</Text></Box>;
    case "outgoing":
      return <Box><Text color="green">→ </Text><Text dimColor>{msg.meta} </Text><Text wrap="wrap">{msg.text}</Text></Box>;
    case "heartbeat":
      return <Box><Text dimColor>♡ heartbeat</Text></Box>;
    case "tool":
      return <Box><Text color="yellow">{msg.text}</Text></Box>;
    case "error":
      return <Box><Text color="red">{msg.text}</Text></Box>;
    default:
      return <Text>{msg.text}</Text>;
  }
}

function App({ port, agentName, version }: TuiProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [oldestIndex, setOldestIndex] = useState<number | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const baseUrl = `http://127.0.0.1:${port}`;

  const cols = stdout?.columns || 80;

  // Load initial history
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${baseUrl}/history?limit=30`);
        const history = await res.json();
        if (history.length > 0) {
          setMessages(convertHistory(history));
          if (history[0]?.index !== undefined) setOldestIndex(history[0].index);
        }
      } catch {}
    })();
  }, []);

  // SSE connection
  useEffect(() => {
    let aborted = false;

    function handleEvent(event: ServerEvent) {
      if ((event as any).type === "incoming" && event.fromInterface !== "tui") {
        setMessages((m: ChatMessage[]) => [...m, {
          type: "incoming" as const,
          text: event.text || "",
          meta: `[${event.fromInterface} ${event.fromUserId || ""}]`,
        }]);
        return;
      }
      if ((event as any).type === "outgoing") {
        setMessages((m: ChatMessage[]) => [...m, {
          type: "outgoing" as const,
          text: event.text || "",
          meta: `[→ ${event.fromInterface} ${event.fromUserId || ""}]`,
        }]);
        return;
      }
      if ((event as any).type === "heartbeat") {
        setMessages((m: ChatMessage[]) => [...m, { type: "heartbeat" as const, text: "" }]);
        return;
      }

      switch (event.type) {
        case "text-delta":
          setStreamingText((s: string) => s + (event.text || ""));
          setBusy(true);
          break;
        case "tool-call": {
          const detail = event.toolDetail ? ` ${event.toolDetail}` : "";
          setMessages((m: ChatMessage[]) => [...m, { type: "tool" as const, text: `${event.toolName}${detail}` }]);
          setBusy(true);
          break;
        }
        case "finish":
          setStreamingText((s: string) => {
            if (s) setMessages((m: ChatMessage[]) => [...m, { type: "assistant" as const, text: s }]);
            return "";
          });
          setBusy(false);
          break;
        case "error":
          setMessages((m: ChatMessage[]) => [...m, { type: "error" as const, text: event.error || "Unknown error" }]);
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
            try { handleEvent(JSON.parse(line.slice(6))); } catch {}
          }
        }
      } catch {
        if (!aborted) setTimeout(connect, 2000);
      }
    }

    connect();
    return () => { aborted = true; };
  }, []);

  useInput((ch: string, key: any) => {
    if (key.escape) { exit(); return; }
    if (key.return && input.trim() && !busy) {
      const text = input.trim();
      setInput("");
      setMessages((m: ChatMessage[]) => [...m, { type: "user" as const, text }]);
      setBusy(true);
      fetch(`${baseUrl}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, userId: "tui", interface: "tui", channel: "tui" }),
      }).catch(() => {
        setMessages((m: ChatMessage[]) => [...m, { type: "error" as const, text: "Connection error" }]);
        setBusy(false);
      });
      return;
    }
    if (key.backspace || key.delete) { setInput((s: string) => s.slice(0, -1)); return; }
    if (ch && !key.ctrl && !key.meta) { setInput((s: string) => s + ch); }
  });

  return (
    <Box flexDirection="column">
      {/* Status bar */}
      <Box>
        <Text bold color="white" backgroundColor="gray">
          {" "}kern{" "}
        </Text>
        <Text backgroundColor="gray" dimColor>
          {" "}v{version} · {agentName} · :{port}{" "}
        </Text>
        <Text backgroundColor="gray">
          {" ".repeat(Math.max(0, cols - 20 - version.length - agentName.length - String(port).length))}
        </Text>
      </Box>

      {/* Completed messages — rendered once, scroll up via terminal */}
      <Static items={messages.map((msg, i) => ({ id: String(i), msg }))}>
        {({ id, msg }) => (
          <Box key={id}>
            <MessageView msg={msg} width={cols} />
          </Box>
        )}
      </Static>

      {/* Active area — streaming, spinner, input */}
      <Box flexDirection="column">
        {streamingText && (
          <Box><Text color="blue">◆ </Text><Text wrap="wrap">{streamingText}</Text></Box>
        )}

        {busy && !streamingText && (
          <Box>
            <Text color="blue">◆ </Text>
            {/* @ts-ignore */}
            <Text color="blue"><Spinner type="dots" /></Text>
            <Text dimColor> thinking...</Text>
          </Box>
        )}

        <Box marginTop={1}>
          <Text color="green" bold>{">"} </Text>
          <Text>{input}</Text>
          {!busy && <Text dimColor>▎</Text>}
        </Box>
      </Box>
    </Box>
  );
}

export async function connectTuiV2(port: number, agentName: string): Promise<void> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/status`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
}
