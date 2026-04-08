"use client";

import { useState, useEffect, useRef } from "react";

const THEMES = [
  "github-dark-dimmed",
  "github-dark",
  "atom-one-dark",
  "nord",
  "monokai",
  "tokyo-night-dark",
  "vs2015",
  "dracula",
  "panda-syntax-dark",
  "androidstudio",
  "stackoverflow-dark",
];

const CDN = "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/styles";
const STORAGE_KEY = "kern-hljs-theme";
const DEFAULT_THEME = "github-dark-dimmed";

function loadTheme(theme: string) {
  const id = "hljs-theme";
  let link = document.getElementById(id) as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    document.head.appendChild(link);
  }
  link.href = `${CDN}/${theme}.min.css`;
}

export type ChatLayout = "bubble" | "flat";

export interface Preferences {
  chatLayout: ChatLayout;
  coloredTools: boolean;
  peekLastTool: boolean;
  showTools: boolean;
}

const PREFS_DEFAULTS: Preferences = {
  chatLayout: "bubble",
  coloredTools: true,
  peekLastTool: true,
  showTools: true,
};

export function usePreferences() {
  const [prefs, setPrefsState] = useState<Preferences>(PREFS_DEFAULTS);
  useEffect(() => {
    const saved = localStorage.getItem("kern-prefs");
    if (saved) {
      try { setPrefsState({ ...PREFS_DEFAULTS, ...JSON.parse(saved) }); } catch {}
    }
  }, []);
  const setPrefs = (partial: Partial<Preferences>) => {
    setPrefsState((prev) => {
      const next = { ...prev, ...partial };
      localStorage.setItem("kern-prefs", JSON.stringify(next));
      return next;
    });
  };
  return { prefs, setPrefs };
}

export function ThemePicker({ prefs, onPrefsChange }: { prefs: Preferences; onPrefsChange: (p: Partial<Preferences>) => void }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(DEFAULT_THEME);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) || DEFAULT_THEME;
    setCurrent(saved);
    loadTheme(saved);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const select = (theme: string) => {
    setCurrent(theme);
    localStorage.setItem(STORAGE_KEY, theme);
    loadTheme(theme);
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="px-1.5 py-1 text-sm rounded text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-surface)] transition-colors leading-none cursor-pointer"
        title="Preferences"
      >
        ◐
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg shadow-lg z-50 py-1 min-w-[200px]">
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
            Layout
          </div>
          {([["bubble", "Bubble"], ["flat", "Flat"]] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => onPrefsChange({ chatLayout: key })}
              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--border)] transition-colors cursor-pointer ${
                key === prefs.chatLayout ? "text-[var(--accent)]" : "text-[var(--text-dim)]"
              }`}
            >
              {key === prefs.chatLayout && "● "}{label}
            </button>
          ))}
          <div className="border-t border-[var(--border)] my-1" />
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
            Tools
          </div>
          <button
            onClick={() => onPrefsChange({ showTools: !prefs.showTools })}
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--border)] transition-colors cursor-pointer text-[var(--text-dim)]"
          >
            {prefs.showTools ? "●" : "○"} Show tool calls
          </button>
          <button
            onClick={() => onPrefsChange({ coloredTools: !prefs.coloredTools })}
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--border)] transition-colors cursor-pointer text-[var(--text-dim)]"
          >
            {prefs.coloredTools ? "●" : "○"} Colored tool names
          </button>
          <button
            onClick={() => onPrefsChange({ peekLastTool: !prefs.peekLastTool })}
            className="w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--border)] transition-colors cursor-pointer text-[var(--text-dim)]"
          >
            {prefs.peekLastTool ? "●" : "○"} Peek last tool output
          </button>
          <div className="border-t border-[var(--border)] my-1" />
          <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
            Code Theme
          </div>
          {THEMES.map((t) => (
            <button
              key={t}
              onClick={() => select(t)}
              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--border)] transition-colors cursor-pointer ${
                t === current ? "text-[var(--accent)]" : "text-[var(--text-dim)]"
              }`}
            >
              {t === current && "● "}{t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
