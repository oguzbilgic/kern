"use client";

import { useState, useEffect, useRef } from "react";

export function ThinkingDots({ agentName, activity }: { agentName?: string; activity?: string }) {
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
    </span>
  );

  if (agentName) {
    const label = activity && activity !== "thinking"
      ? `is ${activity}`
      : "is thinking";

    return (
      <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] py-1">
        <span className="font-medium">{agentName}</span>
        <FlipText text={label} />
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

function FlipText({ text }: { text: string }) {
  const [display, setDisplay] = useState(text);
  const [animating, setAnimating] = useState(false);
  const prevRef = useRef(text);

  useEffect(() => {
    if (text !== prevRef.current) {
      prevRef.current = text;
      setAnimating(true);
      // After exit animation, swap text and enter
      const timer = setTimeout(() => {
        setDisplay(text);
        setAnimating(false);
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [text]);

  return (
    <span
      className="inline-block overflow-hidden"
      style={{ height: "1.3em", verticalAlign: "bottom" }}
    >
      <span
        style={{
          display: "inline-block",
          transition: "transform 150ms ease, opacity 150ms ease",
          transform: animating ? "translateY(-100%)" : "translateY(0)",
          opacity: animating ? 0 : 1,
        }}
      >
        {display}
      </span>
      <style>{`
        @keyframes dotPulse {
          0%, 80%, 100% { opacity: 0.25; }
          40% { opacity: 0.9; }
        }
      `}</style>
    </span>
  );
}
