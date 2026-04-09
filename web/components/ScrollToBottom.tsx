"use client";

export function ScrollToBottom({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        position: "absolute",
        bottom: 12,
        left: "50%",
        transform: "translateX(-50%)",
        width: 40,
        height: 40,
        borderRadius: "50%",
        background: "var(--bg-secondary, var(--bg-surface))",
        border: "1px solid var(--border)",
        color: "var(--text)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        fontSize: 20,
        boxShadow: "0 2px 12px rgba(0,0,0,0.4)",
        opacity: 0.85,
        zIndex: 10,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
      onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.85"; }}
      title="Scroll to bottom"
    >
      ↓
    </button>
  );
}
