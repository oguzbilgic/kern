"use client";

import { useState, useRef, useCallback, useEffect, type KeyboardEvent } from "react";
import type { Attachment } from "../lib/types";

const SLASH_COMMANDS = [
  { name: "/status", desc: "agent status, uptime, token usage" },
  { name: "/restart", desc: "restart the agent process" },
  { name: "/help", desc: "list available commands" },
];

interface InputProps {
  onSend: (text: string, attachments?: Attachment[]) => void;
  disabled?: boolean;
  externalAttachments?: Attachment[];
  onExternalConsumed?: () => void;
}

export function fileToAttachment(file: File): Promise<Attachment> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      const type = file.type.startsWith("image/")
        ? "image"
        : file.type.startsWith("video/")
          ? "video"
          : file.type.startsWith("audio/")
            ? "audio"
            : "document";
      resolve({
        type: type as Attachment["type"],
        mimeType: file.type || "application/octet-stream",
        filename: file.name,
        base64,
        dataUrl: reader.result as string,
        size: file.size,
        file,
      });
    };
    reader.readAsDataURL(file);
  });
}

export function Input({ onSend, disabled, externalAttachments, onExternalConsumed }: InputProps) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [cmdFiltered, setCmdFiltered] = useState<typeof SLASH_COMMANDS>([]);
  const [cmdIdx, setCmdIdx] = useState(0);
  const [cmdOpen, setCmdOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const canSend = text.trim() || attachments.length > 0;

  // Consume externally added attachments (drag-and-drop)
  useEffect(() => {
    if (externalAttachments?.length) {
      setAttachments((prev) => [...prev, ...externalAttachments]);
      onExternalConsumed?.();
    }
  }, [externalAttachments, onExternalConsumed]);

  // Update slash popup based on input
  useEffect(() => {
    const val = text.trim().toLowerCase();
    if (val.startsWith("/") && !val.includes(" ")) {
      const matches = SLASH_COMMANDS.filter((c) => c.name.startsWith(val));
      setCmdFiltered(matches);
      setCmdOpen(matches.length > 0);
      setCmdIdx((prev) => Math.min(prev, Math.max(0, matches.length - 1)));
    } else {
      setCmdFiltered([]);
      setCmdOpen(false);
    }
  }, [text]);

  const selectCommand = useCallback(
    (idx: number) => {
      const cmd = cmdFiltered[idx];
      if (!cmd) return;
      setText(cmd.name);
      setCmdOpen(false);
      setCmdFiltered([]);
      // Send immediately
      onSend(cmd.name);
      setText("");
      textareaRef.current?.focus();
    },
    [cmdFiltered, onSend]
  );

  const handleSend = useCallback(() => {
    if (!canSend || disabled) return;
    onSend(text.trim(), attachments.length > 0 ? attachments : undefined);
    setText("");
    setAttachments([]);
    setCmdOpen(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.focus();
    }
  }, [text, attachments, canSend, disabled, onSend]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (cmdOpen && cmdFiltered.length > 0) {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setCmdIdx((i) => (i <= 0 ? cmdFiltered.length - 1 : i - 1));
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setCmdIdx((i) => (i >= cmdFiltered.length - 1 ? 0 : i + 1));
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        selectCommand(cmdIdx);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setCmdOpen(false);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  async function addFiles(files: FileList | File[]) {
    const newAttachments: Attachment[] = [];
    for (const file of Array.from(files)) {
      if (file.size > 20 * 1024 * 1024) continue;
      const att = await fileToAttachment(file);
      newAttachments.push(att);
    }
    setAttachments((prev) => [...prev, ...newAttachments]);
  }

  return (
    <div
      className="px-4 py-3 flex-shrink-0 flex justify-center"
      style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
    >
    <div style={{ width: "100%", maxWidth: 800 }}>
      {/* Attachment previews */}
      {attachments.length > 0 && (
        <div className="flex gap-2 mb-2 flex-wrap">
          {attachments.map((att, i) => (
            <div key={i} className="relative">
              {att.type === "image" && att.dataUrl ? (
                <img
                  src={att.dataUrl}
                  alt={att.filename}
                  className="w-16 h-16 object-cover rounded border border-[var(--border)]"
                />
              ) : (
                <div className="w-16 h-16 rounded border border-[var(--border)] flex items-center justify-center text-xs text-[var(--text-dim)] bg-[var(--bg-surface)]">
                  📄
                </div>
              )}
              <button
                onClick={() =>
                  setAttachments((prev) => prev.filter((_, j) => j !== i))
                }
                className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[var(--bg)] border border-[var(--border)] text-[10px] text-[var(--text-dim)] flex items-center justify-center hover:text-white"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input row with popup */}
      <div className="relative">
        {/* Slash command popup */}
        {cmdOpen && cmdFiltered.length > 0 && (
          <div
            className="absolute left-2 right-2 bottom-full mb-2 overflow-hidden z-50"
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border)",
              borderRadius: 10,
              boxShadow: "0 12px 32px rgba(0,0,0,0.35)",
            }}
          >
            {cmdFiltered.map((cmd, i) => (
              <div
                key={cmd.name}
                className="flex items-baseline gap-3 px-3 py-2 cursor-pointer"
                style={{
                  fontSize: 14,
                  background: i === cmdIdx ? "rgba(255,255,255,0.05)" : "transparent",
                }}
                onMouseEnter={() => setCmdIdx(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectCommand(i);
                }}
              >
                <span className="font-mono font-semibold whitespace-nowrap" style={{ color: "var(--text)" }}>
                  {cmd.name}
                </span>
                <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{cmd.desc}</span>
              </div>
            ))}
          </div>
        )}

        {/* Input pill */}
        <div
          className="input-pill flex flex-col overflow-visible"
          style={{
            background: "var(--bg-input)",
            border: "1.5px solid var(--border)",
            borderRadius: 22,
            transition: "border-color 0.15s",
          }}
          onFocus={() => {
            const el = document.querySelector(".input-pill") as HTMLElement;
            if (el) {
              el.style.borderColor = "var(--text-muted)";
              el.style.boxShadow = "0 0 0 1px rgba(255,255,255,0.04)";
            }
          }}
          onBlur={() => {
            const el = document.querySelector(".input-pill") as HTMLElement;
            if (el) {
              el.style.borderColor = "var(--border)";
              el.style.boxShadow = "none";
            }
          }}
        >
          <div className="flex items-center" style={{ padding: "4px 6px 4px 4px" }}>
            {/* Attach button */}
            <button
              onClick={() => fileRef.current?.click()}
              className="flex items-center flex-shrink-0"
              style={{ background: "none", border: "none", color: "var(--text-dim)", cursor: "pointer", padding: "0 8px", minHeight: 36 }}
              title="Attach file"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
            </button>

            <input
              ref={fileRef}
              type="file"
              className="hidden"
              multiple
              onChange={(e) => {
                if (e.target.files?.length) addFiles(e.target.files);
                e.target.value = "";
              }}
            />

            {/* Text input */}
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                // Auto-grow
                const ta = e.target;
                ta.style.height = "auto";
                ta.style.height = Math.min(ta.scrollHeight, window.innerHeight * 0.4) + "px";
              }}
              onKeyDown={handleKeyDown}
              placeholder="Message..."
              rows={1}
              style={{
                flex: 1,
                background: "transparent",
                color: "var(--text)",
                border: "none",
                padding: "10px",
                fontFamily: "var(--font-sans)",
                fontSize: "14.5px",
                lineHeight: 1.5,
                resize: "none",
                outline: "none",
                minHeight: 36,
                maxHeight: "40vh",
                overflowY: "hidden",
              }}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />

            {/* Send button */}
            <button
              onClick={handleSend}
              disabled={!canSend || disabled}
              className="flex items-center justify-center flex-shrink-0 transition-colors"
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                border: "none",
                cursor: canSend && !disabled ? "pointer" : "not-allowed",
                background: canSend && !disabled ? "var(--text)" : "transparent",
                color: canSend && !disabled ? "var(--bg)" : "var(--text-dim)",
                opacity: canSend && !disabled ? 1 : 0.2,
                marginBottom: 2,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
    </div>
  );
}
