"use client";

export function ThinkingDots({ agentName }: { agentName?: string }) {
  const dots = (
    <span className="inline-flex items-center gap-1 ml-0.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="inline-block w-[6px] h-[6px] rounded-full"
          style={{
            backgroundColor: "var(--text-muted)",
            animation: "dotPulse 1.2s ease-in-out infinite",
            animationDelay: `${i * 200}ms`,
          }}
        />
      ))}
      <style>{`
        @keyframes dotPulse {
          0%, 80%, 100% { opacity: 0.25; }
          40% { opacity: 0.9; }
        }
      `}</style>
    </span>
  );

  if (agentName) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] py-1">
        <span className="font-medium">{agentName}</span>
        <span>is thinking</span>
        {dots}
      </div>
    );
  }

  return (
    <div className="flex justify-start py-1">
      {dots}
    </div>
  );
}
