import type { StatusData } from "../lib/types";

interface InfoPanelProps {
  status: StatusData | null;
  connected: boolean;
  onClose: () => void;
}

export function InfoPanel({ status, connected, onClose }: InfoPanelProps) {
  if (!status) return null;

  const bd = status.contextBreakdown;

  const rows: [string, string][] = [
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

  return (
    <div
      className="absolute left-0 right-0 top-12 z-40 border-b border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3"
      onClick={onClose}
    >
      <table className="text-[11px]">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <td className="text-[var(--text-muted)] pr-4 py-[2px] align-top whitespace-nowrap">{label}</td>
              <td className="text-[var(--text-dim)] font-mono py-[2px]">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
