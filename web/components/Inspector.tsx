"use client";

import { useState } from "react";
import { SessionsTab } from "./inspector/SessionsTab";
import { SegmentsTab } from "./inspector/SegmentsTab";
import { NotesTab } from "./inspector/NotesTab";
import { RecallTab } from "./inspector/RecallTab";
import { MediaTab } from "./inspector/MediaTab";
import { ContextTab } from "./inspector/ContextTab";

interface InspectorProps {
  open: boolean;
  onClose: () => void;
  agentName: string;
  token: string | null;
  serverUrl?: string;
}

type Tab = "sessions" | "segments" | "notes" | "recall" | "media" | "context";

const TABS: { key: Tab; label: string }[] = [
  { key: "sessions", label: "Sessions" },
  { key: "segments", label: "Segments" },
  { key: "notes", label: "Notes" },
  { key: "recall", label: "Recall" },
  { key: "media", label: "Media" },
  { key: "context", label: "Context" },
];

const accent = "#e5b567";

export function Inspector({ open, onClose, agentName, token, serverUrl }: InspectorProps) {
  const [tab, setTab] = useState<Tab>("sessions");

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)", padding: 28 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="flex flex-col overflow-hidden"
        style={{
          width: "min(1400px, calc(100vw - 56px))",
          maxHeight: "calc(100vh - 56px)",
          background: "#202020",
          border: "1px solid var(--border)",
          borderRadius: 14,
          boxShadow: "0 24px 80px rgba(0,0,0,0.5)",
        }}
      >
        {/* Header */}
        <div
          className="flex justify-between items-start gap-4"
          style={{ padding: "22px 24px 16px", borderBottom: "1px solid var(--border)" }}
        >
          <div>
            <h2 style={{ color: "var(--text)", fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Memory</h2>
            <span style={{ color: "var(--text-muted)", fontSize: 12, fontFamily: "var(--font-mono)" }}>
              {TABS.find((t) => t.key === tab)?.label}
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "rgba(255,255,255,0.03)",
              border: "1px solid var(--border)",
              color: "var(--text-dim)",
              fontSize: 18,
              padding: "4px 10px",
              borderRadius: 10,
              cursor: "pointer",
              lineHeight: 1,
            }}
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 0, padding: "0 16px", borderBottom: "1px solid var(--border)" }}>
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                background: "none",
                border: "none",
                borderBottom: `2px solid ${tab === t.key ? accent : "transparent"}`,
                color: tab === t.key ? "var(--text)" : "var(--text-muted)",
                fontSize: 13,
                fontWeight: 500,
                padding: "9px 14px",
                cursor: "pointer",
                transition: "color 0.15s, border-color 0.15s",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: "auto", padding: 20 }}>
          {tab === "sessions" && <SessionsTab agentName={agentName} token={token} serverUrl={serverUrl} />}
          {tab === "segments" && <SegmentsTab agentName={agentName} token={token} serverUrl={serverUrl} />}
          {tab === "notes" && <NotesTab agentName={agentName} token={token} serverUrl={serverUrl} />}
          {tab === "recall" && <RecallTab agentName={agentName} token={token} serverUrl={serverUrl} />}
          {tab === "media" && <MediaTab agentName={agentName} token={token} serverUrl={serverUrl} />}
          {tab === "context" && <ContextTab agentName={agentName} token={token} serverUrl={serverUrl} />}
        </div>
      </div>
    </div>
  );
}
