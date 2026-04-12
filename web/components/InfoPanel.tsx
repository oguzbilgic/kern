import { useState } from "react";
import type { StatusData } from "../lib/types";

interface InfoPanelProps {
  status: StatusData | null;
  connected: boolean;
  pinned: Set<string>;
  onTogglePin: (key: string) => void;
  onClose: () => void;
  baseUrl?: string;
  token?: string;
}

function getRows(status: StatusData): [string, string][] {
  const bd = status.contextBreakdown;
  return [
    ["Model", status.model],
    ["Version", status.version],
    ["Uptime", status.uptime],
    ["Session", status.session],
    ["Context", status.context],
    ...(bd ? [["Messages", `${bd.messageCount} msgs · ${bd.messageTokens.toLocaleString()} tokens`] as [string, string]] : []),
    ...(bd?.summaryTokens ? [["Summary", `${bd.summaryTokens.toLocaleString()} tokens`] as [string, string]] : []),
    ...(bd?.systemPromptTokens ? [["System prompt", `${bd.systemPromptTokens.toLocaleString()} tokens`] as [string, string]] : []),
    ["API usage", status.apiUsage],
    ["Cache", status.cacheUsage],
    ["Tools", status.toolScope],
    ["Queue", status.queue],
    ["Recall", status.recall],
    ["Telegram", status.telegram],
    ["Slack", status.slack],
    ["Hub", status.hub],
  ].filter((r): r is [string, string] => !!r[1]);
}

export function PinnedStats({ status, pinned, baseUrl, token }: { status: StatusData | null; pinned: Set<string>; baseUrl?: string; token?: string }) {
  if (pinned.size === 0) return null;
  const rows = status ? getRows(status) : [];
  const connectionRows: [string, string][] = [];
  if (baseUrl) connectionRows.push(["URL", baseUrl]);
  if (token) connectionRows.push(["Token", maskToken(token)]);
  const allRows = [...rows, ...connectionRows];
  const items = allRows.filter(([label]) => pinned.has(label));
  if (items.length === 0) return null;

  return (
    <div className="flex items-baseline gap-3">
      {items.map(([label, value]) => (
        <span key={label} className="text-[11px] text-[var(--text-muted)] font-mono">{value}</span>
      ))}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button onClick={copy} className="ml-2 text-[10px] text-[var(--text-muted)] hover:text-[var(--text-dim)] transition-colors">
      {copied ? "✓" : "copy"}
    </button>
  );
}

function maskToken(token: string): string {
  if (token.length <= 8) return "••••••••";
  return "••••••••" + token.slice(-4);
}

export function InfoPanel({ status, connected, pinned, onTogglePin, onClose, baseUrl, token }: InfoPanelProps) {
  if (!status) return null;

  const rows = getRows(status);

  return (
    <div
      className="absolute left-0 right-0 top-12 z-40 border-b border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3"
      onClick={onClose}
    >
      <table className="text-[11px]" onClick={(e) => e.stopPropagation()}>
        <tbody>
          {rows.map(([label, value]) => (
            <tr
              key={label}
              className="cursor-pointer"
              onClick={() => onTogglePin(label)}
            >
              <td className="pr-1 py-[2px] align-top">
                <span className={`text-[10px] ${pinned.has(label) ? "text-[var(--text-dim)]" : "text-[var(--border)]"}`}>
                  {pinned.has(label) ? "●" : "○"}
                </span>
              </td>
              <td className="text-[var(--text-muted)] pr-4 py-[2px] align-top whitespace-nowrap">{label}</td>
              <td className="text-[var(--text-dim)] font-mono py-[2px]">{value}</td>
            </tr>
          ))}
          {(baseUrl || token) && (
            <>

              {baseUrl && (
                <tr className="cursor-pointer" onClick={() => onTogglePin("URL")}>
                  <td className="pr-1 py-[2px] align-top">
                    <span className={`text-[10px] ${pinned.has("URL") ? "text-[var(--text-dim)]" : "text-[var(--border)]"}`}>
                      {pinned.has("URL") ? "●" : "○"}
                    </span>
                  </td>
                  <td className="text-[var(--text-muted)] pr-4 py-[2px] align-top whitespace-nowrap">URL</td>
                  <td className="text-[var(--text-dim)] font-mono py-[2px]">
                    {baseUrl}<CopyButton text={baseUrl} />
                  </td>
                </tr>
              )}
              {token && (
                <tr className="cursor-pointer" onClick={() => onTogglePin("Token")}>
                  <td className="pr-1 py-[2px] align-top">
                    <span className={`text-[10px] ${pinned.has("Token") ? "text-[var(--text-dim)]" : "text-[var(--border)]"}`}>
                      {pinned.has("Token") ? "●" : "○"}
                    </span>
                  </td>
                  <td className="text-[var(--text-muted)] pr-4 py-[2px] align-top whitespace-nowrap">Token</td>
                  <td className="text-[var(--text-dim)] font-mono py-[2px]">
                    {maskToken(token)}<CopyButton text={token} />
                  </td>
                </tr>
              )}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}
