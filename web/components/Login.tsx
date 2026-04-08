"use client";

import { useState } from "react";
import * as api from "../lib/api";

interface LoginProps {
  onLogin: (token: string) => void;
}

export function Login({ onLogin }: LoginProps) {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const t = token.trim();
    if (!t) return;

    setLoading(true);
    setError(null);

    try {
      await api.fetchAgents(t);
      onLogin(t);
    } catch {
      setError("Invalid token or server unreachable");
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-center justify-center h-full w-full bg-[var(--bg)] relative">
      <div className="flex flex-col items-center gap-6 w-[320px]">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3">
          <div className="text-2xl font-bold text-[var(--text)]">
            kern<span className="text-[var(--accent)]">.</span>
          </div>
          <p className="text-xs text-[var(--text-muted)]">Enter your access token to connect</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="w-full flex flex-col gap-3">
          <input
            type="password"
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              if (error) setError(null);
            }}
            placeholder="Access token"
            autoFocus
            className="w-full bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg px-3 py-2.5 text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--accent-dim)] transition-colors"
          />

          {error && (
            <p className="text-xs text-[var(--red)]">{error}</p>
          )}

          <button
            type="submit"
            disabled={!token.trim() || loading}
            className="w-full bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text)] text-sm font-medium py-2.5 rounded-lg hover:border-[var(--text-muted)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "Connecting..." : "Connect"}
          </button>
        </form>

        <p className="text-[11px] text-[var(--text-muted)] text-center leading-relaxed">
          Run <code className="text-[var(--text-dim)] font-mono bg-[var(--bg-surface)] px-1.5 py-0.5 rounded">kern web token</code> to get your token
        </p>

      </div>

      <div className="absolute bottom-6 flex items-center gap-4 text-[11px] text-[var(--text-muted)]">
        <a href="https://kern-ai.com" target="_blank" rel="noopener noreferrer" className="hover:text-[var(--text-dim)] transition-colors">Website</a>
        <a href="https://github.com/oguzbilgic/kern-ai" target="_blank" rel="noopener noreferrer" className="hover:text-[var(--text-dim)] transition-colors">GitHub</a>
      </div>
    </div>
  );
}
