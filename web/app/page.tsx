"use client";

import { useAuth } from "../hooks/useAuth";
import { useServers } from "../hooks/useServers";
import { useAgent } from "../hooks/useAgent";
import { Login } from "../components/Login";
import { Sidebar } from "../components/Sidebar";
import { Chat } from "../components/Chat";
import { Input } from "../components/Input";
import type { Attachment } from "../lib/types";

export default function Home() {
  const { token, setToken } = useAuth();
  const validToken = token ?? null;
  const { agents, activeAgent, active, setActive, addServer, removeServer } = useServers(validToken);
  const { messages, streamParts, thinking, connected, status, send } = useAgent(activeAgent, { withHistory: true });

  if (token === undefined) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-sm text-[var(--text-dim)]">Loading...</div>
      </div>
    );
  }

  if (!token) {
    return <Login onLogin={setToken} />;
  }

  function handleLogout() {
    localStorage.removeItem("kern-token");
    window.location.reload();
  }

  return (
    <div className="flex h-full w-full">
      <Sidebar
        agents={agents}
        active={active}
        activeThinking={thinking}
        onSelect={setActive}
        onLogout={handleLogout}
        onAddServer={addServer}
        onRemoveServer={removeServer}
      />

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

        <Chat
          messages={messages}
          streamParts={streamParts}
          thinking={thinking}
          agentName={activeAgent?.name}
          token={token ?? undefined}
        />

        <Input
          onSend={(text: string, attachments?: Attachment[]) => send(text, attachments)}
          disabled={!connected}
        />
      </div>
    </div>
  );
}
