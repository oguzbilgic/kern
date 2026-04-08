"use client";

export function ThinkingDots() {
  return (
    <div className="flex justify-start mb-2">
      <div className="px-3 py-2 text-sm text-[var(--text-muted)]">
        <span className="inline-flex gap-0.5">
          <span className="animate-bounce" style={{ animationDelay: "0ms" }}>·</span>
          <span className="animate-bounce" style={{ animationDelay: "150ms" }}>·</span>
          <span className="animate-bounce" style={{ animationDelay: "300ms" }}>·</span>
        </span>
      </div>
    </div>
  );
}
