"use client";

import { useEffect, useState } from "react";

export default function Home() {
  const [status, setStatus] = useState<string>("connecting...");
  const [agents, setAgents] = useState<string[]>([]);

  useEffect(() => {
    const token = localStorage.getItem("kern-token") || new URLSearchParams(window.location.search).get("token");
    if (token) {
      localStorage.setItem("kern-token", token);
      // Clean URL
      if (window.location.search.includes("token")) {
        window.history.replaceState({}, "", window.location.pathname);
      }
    }

    async function discover() {
      try {
        const res = await fetch("/api/agents", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.status === 401) {
          setStatus("unauthorized — need token");
          return;
        }
        const data = await res.json();
        setAgents(data.map((a: { name: string }) => a.name));
        setStatus("connected");
      } catch {
        setStatus("failed to connect");
      }
    }

    discover();
  }, []);

  return (
    <div className="flex h-full w-full">
      {/* Sidebar */}
      <div className="w-[200px] bg-[var(--bg-sidebar)] border-r border-[var(--border)] flex flex-col p-3">
        <div className="text-sm font-semibold mb-4">
          kern<span className="text-[var(--accent)]">.</span>
        </div>
        <div className="flex flex-col gap-1">
          {agents.map((name) => (
            <div
              key={name}
              className="flex items-center gap-2 px-2 py-1.5 rounded text-sm hover:bg-[var(--bg-surface)] cursor-pointer"
            >
              <div className="w-6 h-6 rounded-full bg-[var(--accent-dim)] flex items-center justify-center text-xs font-bold uppercase">
                {name[0]}
              </div>
              {name}
            </div>
          ))}
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col">
        <div className="h-12 border-b border-[var(--border)] flex items-center px-4 text-sm font-semibold">
          kern
        </div>
        <div className="flex-1 flex items-center justify-center text-[var(--text-dim)] text-sm">
          {status}
        </div>
      </div>
    </div>
  );
}
