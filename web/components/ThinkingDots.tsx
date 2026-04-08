"use client";

export function ThinkingDots() {
  return (
    <div className="flex justify-start px-3 py-1">
      <div className="inline-flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="block w-[6px] h-[6px] rounded-full"
            style={{
              backgroundColor: "var(--text-muted)",
              animation: "dotPulse 1.2s ease-in-out infinite",
              animationDelay: `${i * 200}ms`,
            }}
          />
        ))}
      </div>
      <style>{`
        @keyframes dotPulse {
          0%, 80%, 100% { opacity: 0.25; }
          40% { opacity: 0.9; }
        }
      `}</style>
    </div>
  );
}
