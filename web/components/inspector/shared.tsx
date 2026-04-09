"use client";

import React from "react";

export interface TabProps {
  agentName: string;
  token: string | null;
  serverUrl?: string;
}

// Warm amber accent used throughout the overlay
export const accent = "#e5b567";
export const accentDim = "rgba(229, 181, 103, 0.35)";
export const accentBg = "rgba(229, 181, 103, 0.12)";
export const accentText = "#f0d8a8";

export function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{
      background: "rgba(255,255,255,0.03)",
      border: "1px solid var(--border)",
      borderRadius: 10,
      padding: "10px 12px",
      flex: 1,
      minWidth: 100,
    }}>
      <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text)", lineHeight: 1.3 }}>{value}</div>
      <div style={{
        fontSize: 10,
        color: "var(--text-muted)",
        textTransform: "uppercase" as const,
        letterSpacing: 0.5,
        fontFamily: "var(--font-mono)",
        marginTop: 2,
      }}>{label}</div>
    </div>
  );
}

export function ActionBtn({ onClick, disabled, active, danger, children }: {
  onClick: () => void; disabled?: boolean; active?: boolean; danger?: boolean; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        background: active ? accentBg : "rgba(255,255,255,0.04)",
        border: `1px solid ${active ? accentDim : "var(--border)"}`,
        color: active ? accentText : "var(--text-dim)",
        fontSize: 12,
        fontWeight: 500,
        letterSpacing: 0.2,
        cursor: disabled ? "default" : "pointer",
        padding: "4px 10px",
        borderRadius: 20,
        transition: "all 0.15s",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}

export function EmptyState({ text }: { text: string }) {
  return <div style={{ color: "var(--text-muted)", fontSize: 13, textAlign: "center", padding: "40px 0" }}>{text}</div>;
}
