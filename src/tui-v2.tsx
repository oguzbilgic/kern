import React, { useState, useEffect, useRef } from "react";
import { render, Box, Text, useInput, useApp, useStdout } from "ink";
import Spinner from "ink-spinner";
import type { StreamEvent } from "./runtime.js";
import type { ServerEvent } from "./server.js";
import { log } from "./log.js";

// Colors
const DIM = { dimColor: true } as const;

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

function StatusBar({ agentName, version, port }: { agentName: string; version: string; port: number }) {
  return (
    <Box borderStyle="single" borderBottom={false} borderLeft={false} borderRight={false} paddingX={1}>
      <Text bold>kern</Text>
      <Text dimColor> v{version}</Text>
      <Text dimColor> · </Text>
      <Text color="cyan">{agentName}</Text>
      <Text dimColor> · </Text>
      <Text dimColor>:{port}</Text>
      <Box flexGrow={1} />
      <Text dimColor>ctrl+c to exit</Text>
    </Box>
  );
}

function MessageView({ msg }: { msg: ChatMessage }) {
  switch (msg.type) {
    case "user":
      return (
        <Box>
          <Text color="green" bold>{">"} </Text>
          <Text>{msg.text}</Text>
        </Box>
      );
    case "assistant":
      return (
        <Box>
          <Text color="blue">◆ </Text>
          <Text>{msg.text}</Text>
        </Box>
      );
    case "incoming":
      return (
        <Box>
          <Text color="yellow">◇ </Text>
          <Text dimColor>{msg.meta} </Text>
          <Text>{msg.text}</Text>
        </Box>
      );
    case "outgoing":
      return (
        <Box>
          <Text color="green">→ </Text>
          <Text dimColor>{msg.meta} </Text>
          <Text>{msg.text}</Text>
        </Box>
      );
    case "heartbeat":
      return (
        <Box>
          <Text dimColor>♡ heartbeat</Text>
        </Box>
      );
    case "tool":
      return (
        <Box>
          <Text color="yellow">{msg.text}</Text>
        </Box>
      );
    case "error":
      return (
        <Box>
          <Text color="red">{msg.text}</Text>
        </Box>
      );
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
  const [scrollOffset, setScrollOffset] = useState(0);
  const baseUrl = `http://127.0.0.1:${port}`;

  const rows = stdout?.rows || 24;
  const chatHeight = rows - 4; // status bar + input + borders

  // Connect to SSE
  useEffect(() => {
    let aborted = false;

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
            try {
              const event: ServerEvent = JSON.parse(line.slice(6));
              handleEvent(event);
            } catch {}
          }
        }
      } catch {
        if (!aborted) {
          // Reconnect after delay
          setTimeout(connect, 2000);
        }
      }
    }

    connect();
    return () => { aborted = true; };
  }, []);

  function handleEvent(event: ServerEvent) {
    if ((event as any).type === "incoming" && event.fromInterface !== "tui") {
      const meta = `[${event.fromInterface} ${event.fromUserId || ""}]`;
      setMessages(( prev: ChatMessage[]) => [...prev, { type: "incoming", text: event.text || "", meta }]);
      setScrollOffset(0);
      return;
    }

    if ((event as any).type === "outgoing") {
      const meta = `[→ ${event.fromInterface} ${event.fromUserId || ""}]`;
      setMessages(( prev: ChatMessage[]) => [...prev, { type: "outgoing", text: event.text || "", meta }]);
      return;
    }

    if ((event as any).type === "heartbeat") {
      setMessages(( prev: ChatMessage[]) => [...prev, { type: "heartbeat", text: "" }]);
      return;
    }

    switch (event.type) {
      case "text-delta":
        setStreamingText(( prev: ChatMessage[]) => prev + (event.text || ""));
        setBusy(true);
        break;
      case "tool-call": {
        const detail = event.toolDetail ? ` ${event.toolDetail}` : "";
        setMessages(( prev: ChatMessage[]) => [...prev, { type: "tool", text: `${event.toolName}${detail}` }]);
        setBusy(true);
        break;
      }
      case "finish":
        if (streamingText) {
          setMessages(( prev: ChatMessage[]) => [...prev, { type: "assistant", text: streamingText }]);
        }
        setStreamingText("");
        setBusy(false);
        setScrollOffset(0);
        break;
      case "error":
        setMessages(( prev: ChatMessage[]) => [...prev, { type: "error", text: event.error || "Unknown error" }]);
        setStreamingText("");
        setBusy(false);
        break;
    }
  }

  // Handle input
  useInput((ch, key) => {
    if (key.escape) {
      exit();
      return;
    }

    // Scroll
    if (key.upArrow) {
      setScrollOffset(( prev: ChatMessage[]) => Math.min(prev + 1, Math.max(0, messages.length - chatHeight)));
      return;
    }
    if (key.downArrow) {
      setScrollOffset(( prev: ChatMessage[]) => Math.max(0, prev - 1));
      return;
    }

    if (key.return && input.trim() && !busy) {
      const text = input.trim();
      setInput("");
      setMessages(( prev: ChatMessage[]) => [...prev, { type: "user", text }]);
      setScrollOffset(0);
      setBusy(true);

      // Send message
      fetch(`${baseUrl}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          userId: "tui",
          interface: "tui",
          channel: "tui",
        }),
      }).catch(() => {
        setMessages(( prev: ChatMessage[]) => [...prev, { type: "error", text: "Connection error" }]);
        setBusy(false);
      });
      return;
    }

    if (key.backspace || key.delete) {
      setInput(( prev: ChatMessage[]) => prev.slice(0, -1));
      return;
    }

    if (ch && !key.ctrl && !key.meta) {
      setInput(( prev: ChatMessage[]) => prev + ch);
    }
  });

  // Compute visible messages
  const allItems = [...messages];
  if (streamingText) {
    allItems.push({ type: "assistant", text: streamingText });
  }

  const start = Math.max(0, allItems.length - chatHeight - scrollOffset);
  const visible = allItems.slice(start, start + chatHeight);

  return (
    <Box flexDirection="column" height={rows}>
      {/* Status bar */}
      <StatusBar agentName={agentName} version={version} port={port} />

      {/* Chat area */}
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        {visible.map((msg, i) => (
          <MessageView key={start + i} msg={msg} />
        ))}
        {busy && !streamingText && (
          <Box>
            <Text color="blue">◆ </Text>
            <Spinner type="dots" />
            <Text dimColor> thinking...</Text>
          </Box>
        )}
        {/* Fill remaining space */}
        {visible.length < chatHeight && <Box flexGrow={1} />}
      </Box>

      {/* Input line */}
      <Box borderStyle="single" borderTop={true} borderBottom={false} borderLeft={false} borderRight={false} paddingX={1}>
        <Text color="green" bold>{">"} </Text>
        <Text>{input}</Text>
        {!busy && <Text dimColor>▎</Text>}
      </Box>
    </Box>
  );
}

export async function connectTuiV2(port: number, agentName: string): Promise<void> {
  // Verify connection
  try {
    const res = await fetch(`http://127.0.0.1:${port}/status`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch {
    console.error(`Cannot connect to ${agentName} on port ${port}`);
    process.exit(1);
  }

  // Get version
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
