"use client";

import { useState, useRef, useCallback, type KeyboardEvent } from "react";
import type { Attachment } from "../lib/types";

interface InputProps {
  onSend: (text: string, attachments?: Attachment[]) => void;
  disabled?: boolean;
}

function fileToAttachment(file: File): Promise<Attachment> {
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

export function Input({ onSend, disabled }: InputProps) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const canSend = text.trim() || attachments.length > 0;

  const handleSend = useCallback(() => {
    if (!canSend || disabled) return;
    onSend(
      text.trim(),
      attachments.length > 0 ? attachments : undefined
    );
    setText("");
    setAttachments([]);
    textareaRef.current?.focus();
  }, [text, attachments, canSend, disabled, onSend]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  async function addFiles(files: FileList | File[]) {
    const newAttachments: Attachment[] = [];
    for (const file of Array.from(files)) {
      if (file.size > 20 * 1024 * 1024) continue; // 20MB limit
      const att = await fileToAttachment(file);
      newAttachments.push(att);
    }
    setAttachments((prev) => [...prev, ...newAttachments]);
  }

  return (
    <div className="border-t border-[var(--border)] px-4 py-3"
      style={{ maxWidth: 800, margin: "0 auto", width: "100%" }}
    >
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
                onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[var(--bg)] border border-[var(--border)] text-[10px] text-[var(--text-dim)] flex items-center justify-center hover:text-white"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input row */}
      <div className="flex items-end gap-2 bg-[var(--bg-input)] rounded-2xl border border-[var(--border)] px-3 py-2 focus-within:border-[var(--accent-dim)]">
        {/* Attach button */}
        <button
          onClick={() => fileRef.current?.click()}
          className="text-[var(--text-muted)] hover:text-[var(--text-dim)] pb-0.5"
          title="Attach file"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Message..."
          rows={1}
          className="flex-1 bg-transparent text-sm text-[var(--text)] placeholder-[var(--text-muted)] resize-none outline-none max-h-32"
          style={{ lineHeight: "1.5" }}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />

        {/* Send button */}
        <button
          onClick={handleSend}
          disabled={!canSend || disabled}
          className="w-7 h-7 rounded-full bg-[var(--accent)] text-white flex items-center justify-center disabled:opacity-30 disabled:cursor-default hover:opacity-90 transition-opacity flex-shrink-0"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
