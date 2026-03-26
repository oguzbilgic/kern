import React, { useState, useEffect } from "react";
import { render, Box, Text, useInput, useApp, useStdout } from "ink";
// @ts-ignore — ink-spinner type mismatch with React 19
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
  const chatHeight = rows - 4;

  useEffect(() => {
    let aborted = false;

    function handleEvent(event: ServerEvent) {
      if ((event as any).type === "incoming" && event.fromInterface !== "tui") {
        const meta = `[${event.fromInterface} ${event.fromUserId || ""}]`;
        setMessages((m: ChatMessage[]) => [...m, { type: "incoming" as const, text: event.text || "", meta }]);
        setScrollOffset(0);
        return;
      }

      if ((event as any).type === "outgoing") {
        const meta = `[→ ${event.fromInterface} ${event.fromUserId || ""}]`;
        setMessages((m: ChatMessage[]) => [...m, { type: "outgoing" as const, text: event.text || "", meta }]);
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
            if (s) {
              setMessages((m: ChatMessage[]) => [...m, { type: "assistant" as const, text: s }]);
            }
            return "";
          });
          setBusy(false);
          setScrollOffset(0);
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
            try {
              const event: ServerEvent = JSON.parse(line.slice(6));
              handleEvent(event);
            } catch {}
          }
        }
      } catch {
        if (!aborted) {
          setTimeout(connect, 2000);
        }
      }
    }

    connect();
    return () => { aborted = true; };
  }, []);

  useInput((ch: string, key: any) => {
    if (key.escape) {
      exit();
      return;
    }

    if (key.upArrow) {
      setScrollOffset((n: number) => Math.min(n + 1, Math.max(0, messages.length - chatHeight)));
      return;
    }
    if (key.downArrow) {
      setScrollOffset((n: number) => Math.max(0, n - 1));
      return;
    }

    if (key.return && input.trim() && !busy) {
      const text = input.trim();
      setInput("");
      setMessages((m: ChatMessage[]) => [...m, { type: "user" as const, text }]);
      setScrollOffset(0);
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

    if (key.backspace || key.delete) {
      setInput((s: string) => s.slice(0, -1));
      return;
    }

    if (ch && !key.ctrl && !key.meta) {
      setInput((s: string) => s + ch);
    }
  });

  const allItems: ChatMessage[] = [...messages];
  if (streamingText) {
    allItems.push({ type: "assistant", text: streamingText });
  }

  const start = Math.max(0, allItems.length - chatHeight - scrollOffset);
  const visible = allItems.slice(start, start + chatHeight);

  return (
    <Box flexDirection="column" height={rows}>
      <StatusBar agentName={agentName} version={version} port={port} />

      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        {visible.map((msg, i) => (
          <MessageView key={start + i} msg={msg} />
        ))}
        {busy && !streamingText && (
          <Box>
            <Text color="blue">◆ </Text>
            {/* @ts-ignore */}
            <Text color="blue"><Spinner type="dots" /></Text>
            <Text dimColor> thinking...</Text>
          </Box>
        )}
      </Box>

      <Box borderStyle="single" borderTop={true} borderBottom={false} borderLeft={false} borderRight={false} paddingX={1}>
        <Text color="green" bold>{">"} </Text>
        <Text>{input}</Text>
        {!busy && <Text dimColor>▎</Text>}
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
