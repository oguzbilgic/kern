import type { StatusData } from "../lib/types";

interface InfoPanelProps {
  status: StatusData | null;
  connected: boolean;
  pinned: Set<string>;
  onTogglePin: (key: string) => void;
  onClose: () => void;
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

export function PinnedStats({ status, pinned }: { status: StatusData | null; pinned: Set<string> }) {
  if (!status || pinned.size === 0) return null;
  const rows = getRows(status);
  const items = rows.filter(([label]) => pinned.has(label));
  if (items.length === 0) return null;

  return (
    <div className="flex items-center gap-3">
      {items.map(([label, value]) => (
        <span key={label} className="text-[11px] text-[var(--text-muted)] font-mono">{value}</span>
      ))}
    </div>
  );
}

export function InfoPanel({ status, connected, pinned, onTogglePin, onClose }: InfoPanelProps) {
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
        </tbody>
      </table>
    </div>
  );
}
