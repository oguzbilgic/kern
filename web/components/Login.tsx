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
      // Validate token by fetching agents
      await api.fetchAgents(t);
      onLogin(t);
    } catch {
      setError("Invalid token or server unreachable");
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center justify-center h-full w-full bg-[var(--bg)]">
      <div className="flex flex-col items-center gap-6 w-[320px]">
        {/* Logo / branding */}
        <div className="flex flex-col items-center gap-2">
          <div className="w-12 h-12 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] flex items-center justify-center text-xl font-bold text-[var(--accent)]">
            k.
          </div>
          <h1 className="text-lg font-semibold text-[var(--text)]">kern</h1>
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
            className="w-full bg-[var(--accent)] text-white text-sm font-medium py-2.5 rounded-lg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          >
            {loading ? "Connecting..." : "Connect"}
          </button>
        </form>

        <p className="text-[11px] text-[var(--text-muted)] text-center leading-relaxed">
          Run <code className="text-[var(--text-dim)] font-mono">kern web token</code> to get your token
        </p>
      </div>
    </div>
  );
}
