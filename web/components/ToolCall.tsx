"use client";

import { useState, useRef, useEffect } from "react";
import type { ChatMessage } from "../lib/types";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import json from "highlight.js/lib/languages/json";
import css from "highlight.js/lib/languages/css";
import xml from "highlight.js/lib/languages/xml";
import markdown from "highlight.js/lib/languages/markdown";
import yaml from "highlight.js/lib/languages/yaml";
import rust from "highlight.js/lib/languages/rust";
import go from "highlight.js/lib/languages/go";
import sql from "highlight.js/lib/languages/sql";
import diff from "highlight.js/lib/languages/diff";
import shell from "highlight.js/lib/languages/shell";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("sh", bash);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("ts", typescript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("py", python);
hljs.registerLanguage("json", json);
hljs.registerLanguage("css", css);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("md", markdown);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("yml", yaml);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("rs", rust);
hljs.registerLanguage("go", go);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("diff", diff);
hljs.registerLanguage("shell", shell);

const TOOL_COLORS: Record<string, string> = {
  bash: "#e5c07b",
  read: "#e6edf3",
  write: "#e6edf3",
  edit: "#f97583",
  glob: "#e6edf3",
  grep: "#e6edf3",
  webfetch: "#e6edf3",
  websearch: "#e6edf3",
  pdf: "#e6edf3",
  image: "#e6edf3",
  kern: "#e6edf3",
  recall: "#e6edf3",
  message: "#56d364",
};

const EXT_TO_LANG: Record<string, string> = {
  ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript",
  ".ts": "typescript", ".tsx": "typescript", ".jsx": "javascript",
  ".py": "python", ".json": "json", ".css": "css",
  ".html": "html", ".xml": "xml", ".svg": "xml",
  ".md": "markdown", ".yaml": "yaml", ".yml": "yaml",
  ".rs": "rust", ".go": "go", ".sql": "sql",
  ".sh": "bash", ".bash": "bash", ".zsh": "bash",
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function detectLang(path: string): string | undefined {
  const ext = path.match(/\.[a-zA-Z0-9]+$/)?.[0]?.toLowerCase();
  return ext ? EXT_TO_LANG[ext] : undefined;
}

function highlightCode(code: string, lang?: string): string {
  if (lang && hljs.getLanguage(lang)) {
    try { return hljs.highlight(code, { language: lang }).value; } catch { /* fall through */ }
  }
  return escapeHtml(code);
}

// ANSI escape code to HTML spans
function ansiToHtml(text: string): string {
  const ANSI_COLORS: Record<string, string> = {
    "30": "#545862", "31": "#e06c75", "32": "#98c379", "33": "#e5c07b",
    "34": "#61afef", "35": "#c678dd", "36": "#56b6c2", "37": "#abb2bf",
    "90": "#636d83", "91": "#e06c75", "92": "#98c379", "93": "#e5c07b",
    "94": "#61afef", "95": "#c678dd", "96": "#56b6c2", "97": "#ffffff",
  };
  let result = "";
  let open = false;
  const parts = text.split(/\x1b\[([0-9;]*)m/);
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      result += escapeHtml(parts[i]);
    } else {
      const codes = parts[i].split(";");
      if (open) { result += "</span>"; open = false; }
      for (const c of codes) {
        if (c === "0" || c === "") continue;
        if (c === "1") { result += '<span style="font-weight:bold">'; open = true; }
        else if (ANSI_COLORS[c]) { result += `<span style="color:${ANSI_COLORS[c]}">`; open = true; }
      }
    }
  }
  if (open) result += "</span>";
  return result;
}

function formatBashCommand(cmd: string): string {
  let html = highlightCode(cmd, "bash");
  // Break long commands at separators
  if (cmd.length >= 60) {
    html = html
      .replace(/ &amp;&amp; /g, ' <span class="sep">&amp;&amp;</span>\n  ')
      .replace(/ \|\| /g, ' <span class="sep">||</span>\n  ')
      .replace(/ ; /g, '<span class="sep">;</span>\n  ');
  }
  return html;
}

function toolSummary(msg: ChatMessage): string {
  const input = msg.toolInput || {};
  const name = msg.toolName || "tool";
  switch (name) {
    case "bash": return `${(input.command as string || "").slice(0, 80)}`;
    case "read": return `${input.path || ""}`;
    case "write": return `${input.path || ""}`;
    case "edit": return `${input.path || ""}`;
    case "glob": return `${input.pattern || ""}`;
    case "grep": return `/${input.pattern || ""}/ ${input.path || ""}`;
    case "webfetch": return `${input.url || ""}`;
    case "websearch": return `"${input.query || ""}"`;
    case "message": return `→ ${input.userId || ""} via ${input.interface || ""}`;
    case "pdf": return `${input.file || ""}`;
    case "image": return `${input.file || ""}`;
    case "kern": return `${input.action || ""}`;
    case "recall": return `${input.query || ""}`;
    default: return name;
  }
}

// --- Tool-specific output renderers ---

function BashOutput({ command, output }: { command: string; output: string }) {
  const hasAnsi = /\x1b\[/.test(output);
  return (
    <div className="tool-output-inner">
      {/* Command */}
      <div className="flex gap-2 items-start mb-1">
        <span className="text-[var(--text-muted)] select-none flex-shrink-0">$</span>
        <code
          className="flex-1 whitespace-pre-wrap break-words"
          dangerouslySetInnerHTML={{ __html: formatBashCommand(command) }}
        />
      </div>
      {/* Output */}
      {output && (
        <div
          className="whitespace-pre-wrap break-words text-[var(--text-dim)] mt-1"
          dangerouslySetInnerHTML={{ __html: hasAnsi ? ansiToHtml(output) : escapeHtml(output) }}
        />
      )}
    </div>
  );
}

function ReadOutput({ path, output }: { path: string; output: string }) {
  const lang = detectLang(path);
  const lines = output.split("\n");
  // Parse "lineNum: code" format from read tool
  const parsed = lines.map((line) => {
    const m = line.match(/^(\d+): (.*)$/);
    return m ? { num: m[1], code: m[2] } : { num: "", code: line };
  });

  return (
    <div className="tool-output-inner flex gap-0 text-[11px] leading-[1.5]">
      {/* Line numbers gutter */}
      <div className="text-right pr-2 select-none border-r border-[var(--border)] mr-2 flex-shrink-0 text-[var(--text-muted)]">
        {parsed.map((l, i) => (
          <div key={i}>{l.num}</div>
        ))}
      </div>
      {/* Code */}
      <div className="flex-1 min-w-0 whitespace-pre-wrap break-words">
        {parsed.map((l, i) => (
          <div
            key={i}
            dangerouslySetInnerHTML={{ __html: highlightCode(l.code, lang) || "&nbsp;" }}
          />
        ))}
      </div>
    </div>
  );
}

function EditOutput({ path, input, output }: { path: string; input: Record<string, unknown>; output: string }) {
  const lang = detectLang(path);
  const oldStr = (input.oldString as string) || "";
  const newStr = (input.newString as string) || "";

  // If we have oldString/newString from input, render as diff
  if (oldStr || newStr) {
    const oldLines = oldStr.split("\n");
    const newLines = newStr.split("\n");
    return (
      <div className="tool-output-inner text-[11px] leading-[1.5]">
        {/* Status line */}
        <div className="text-[var(--text-muted)] mb-1">{output}</div>
        {oldLines.map((line, i) => (
          <div key={`old-${i}`} className="flex gap-0 opacity-50">
            <span className="w-4 flex-shrink-0 text-center text-[#f97583] select-none">−</span>
            <span
              className="flex-1 min-w-0 whitespace-pre-wrap break-words"
              dangerouslySetInnerHTML={{ __html: highlightCode(line, lang) || "&nbsp;" }}
            />
          </div>
        ))}
        {oldStr && newStr && <div className="h-1" />}
        {newLines.map((line, i) => (
          <div key={`new-${i}`} className="flex gap-0">
            <span className="w-4 flex-shrink-0 text-center text-[#56d364] select-none">+</span>
            <span
              className="flex-1 min-w-0 whitespace-pre-wrap break-words"
              dangerouslySetInnerHTML={{ __html: highlightCode(line, lang) || "&nbsp;" }}
            />
          </div>
        ))}
      </div>
    );
  }

  // Fallback: plain output
  return <PlainOutput output={output} />;
}

function GrepOutput({ output }: { output: string }) {
  const hasAnsi = /\x1b\[/.test(output);
  return (
    <div className="tool-output-inner">
      <div
        className="whitespace-pre-wrap break-words text-[var(--text-dim)] text-[11px] leading-[1.5]"
        dangerouslySetInnerHTML={{ __html: hasAnsi ? ansiToHtml(output) : escapeHtml(output) }}
      />
    </div>
  );
}

function PlainOutput({ output, maxLen = 2000 }: { output: string; maxLen?: number }) {
  const truncated = output.length > maxLen;
  const text = truncated ? output.slice(0, maxLen) : output;
  return (
    <div className="tool-output-inner">
      <pre className="whitespace-pre-wrap break-words text-[var(--text-dim)] text-[11px] leading-[1.5]">
        {text}
        {truncated && <span className="text-[var(--text-muted)]">{"\n"}… ({output.length - maxLen} chars truncated)</span>}
      </pre>
    </div>
  );
}

function WriteOutput({ path, input, output }: { path: string; input: Record<string, unknown>; output: string }) {
  const lang = detectLang(path);
  const content = (input.content as string) || "";

  if (content) {
    const lines = content.split("\n");
    return (
      <div className="tool-output-inner text-[11px] leading-[1.5]">
        <div className="text-[var(--text-muted)] mb-1">{output}</div>
        <div className="flex gap-0">
          {/* Line numbers gutter */}
          <div className="text-right pr-2 select-none border-r border-[var(--border)] mr-2 flex-shrink-0 text-[var(--text-muted)]">
            {lines.map((_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>
          {/* Code */}
          <div className="flex-1 min-w-0 whitespace-pre-wrap break-words">
            {lines.map((line, i) => (
              <div
                key={i}
                dangerouslySetInnerHTML={{ __html: highlightCode(line, lang) || "&nbsp;" }}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return <PlainOutput output={output} />;
}

function renderToolOutput(msg: ChatMessage) {
  const name = msg.toolName || "";
  const input = msg.toolInput || {};
  const output = msg.toolOutput || "";

  switch (name) {
    case "bash":
      return <BashOutput command={(input.command as string) || ""} output={output} />;
    case "read":
      return <ReadOutput path={(input.path as string) || ""} output={output} />;
    case "write":
      return <WriteOutput path={(input.path as string) || ""} input={input} output={output} />;
    case "edit":
      return <EditOutput path={(input.path as string) || ""} input={input} output={output} />;
    case "grep":
      return <GrepOutput output={output} />;
    case "webfetch":
    case "websearch":
      return <PlainOutput output={output} maxLen={1500} />;
    default:
      return <PlainOutput output={output} />;
  }
}

export function ToolCall({ msg, colored = true, peek = false }: { msg: ChatMessage; colored?: boolean; peek?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const color = colored ? (TOOL_COLORS[msg.toolName || ""] || "#e6edf3") : "#e6edf3";
  const isOpen = expanded || peek;

  // Bash tool gets special styling — show as code block
  const isBash = msg.toolName === "bash";

  return (
    <div className="mb-1">
      {/* Tool header — clickable */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs font-mono w-full text-left hover:opacity-80 py-0.5"
      >
        <span className="opacity-50 text-[10px] text-[var(--text-muted)]">{isOpen ? "▼" : "▶"}</span>
        <span className="font-semibold" style={{ color }}>{msg.toolName}</span>
        <span className="text-[var(--text-muted)] truncate">{toolSummary(msg)}</span>
        {msg.streaming && (
          <span className="animate-pulse ml-1 opacity-60">⋯</span>
        )}
      </button>

      {/* Expanded output */}
      {isOpen && msg.toolOutput && (
        <div className={`mt-1 ml-4 max-h-[400px] overflow-auto rounded font-mono ${
          isBash
            ? "bg-[#161616] p-3 text-xs"
            : "border-l-2 border-[var(--border)] pl-3 py-1 text-xs"
        }`}>
          {renderToolOutput(msg)}
        </div>
      )}
    </div>
  );
}
