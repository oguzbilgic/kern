"use client";

import { useAuth } from "../hooks/useAuth";
import { useAgents } from "../hooks/useAgents";
import { useAgent } from "../hooks/useAgent";
import { Login } from "../components/Login";
import { Sidebar } from "../components/Sidebar";
import { Chat } from "../components/Chat";
import { Input } from "../components/Input";
import type { Attachment } from "../lib/types";

export default function Home() {
  const { token, setToken } = useAuth();
  const validToken = token ?? null;
  const { agents, activeAgent, setActive } = useAgents(validToken);
  const { messages, streamParts, thinking, connected, status, send } = useAgent(activeAgent, validToken);

  // Still checking auth state
  if (token === undefined) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-sm text-[var(--text-dim)]">Loading...</div>
      </div>
    );
  }

  // No token — show login
  if (!token) {
    return <Login onLogin={setToken} />;
  }

  function handleLogout() {
    localStorage.removeItem("kern-token");
    window.location.reload();
  }

  return (
    <div className="flex h-full w-full">
      <Sidebar agents={agents} active={activeAgent?.name || null} onSelect={setActive} onLogout={handleLogout} />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="h-12 border-b border-[var(--border)] flex items-center px-4 gap-3 flex-shrink-0">
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${connected ? "bg-[var(--green)]" : "bg-[var(--text-muted)]"}`}
            />
            <span className="text-sm font-semibold">
              {activeAgent?.name || "no agent"}
            </span>
          </div>
          {status?.model && (
            <span className="text-xs text-[var(--text-muted)]">
              {status.model}
            </span>
          )}
        </div>

        {/* Chat area */}
        <Chat
          messages={messages}
          streamParts={streamParts}
          thinking={thinking}
        />

        {/* Input */}
        <Input
          onSend={(text: string, attachments?: Attachment[]) => send(text, attachments)}
          disabled={!connected}
        />
      </div>
    </div>
  );
}
