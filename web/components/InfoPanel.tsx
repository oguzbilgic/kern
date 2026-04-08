import type { StatusData } from "../lib/types";

interface InfoPanelProps {
  status: StatusData | null;
  connected: boolean;
  onClose: () => void;
}

function Tag({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <span className="inline-flex items-baseline gap-1 text-[11px] whitespace-nowrap">
      <span className="text-[var(--text-muted)]">{label}</span>
      <span className="text-[var(--text-dim)] font-mono">{value}</span>
    </span>
  );
}

const SEP = <span className="text-[var(--border)]">·</span>;

export function InfoPanel({ status, connected, onClose }: InfoPanelProps) {
  if (!status) return null;

  const bd = status.contextBreakdown;

  const all: { label: string; value?: string }[] = [
    { label: "model", value: status.model },
    { label: "v", value: status.version },
    { label: "up", value: status.uptime },
    { label: "session", value: status.session },
    { label: "context", value: status.context },
    ...(bd ? [{ label: "msgs", value: `${bd.messageCount} · ${bd.messageTokens.toLocaleString()}t` }] : []),
    ...(bd?.summaryTokens ? [{ label: "summary", value: `${bd.summaryTokens.toLocaleString()}t` }] : []),
    { label: "api", value: status.apiUsage },
    { label: "cache", value: status.cacheUsage },
    { label: "tools", value: status.toolScope },
    { label: "queue", value: status.queue },
    { label: "recall", value: status.recall },
    { label: "tg", value: status.telegram },
    { label: "slack", value: status.slack },
    { label: "hub", value: status.hub },
  ];
  const tags = all.filter((t): t is { label: string; value: string } => !!t.value);

  return (
    <div
      className="absolute left-0 right-0 top-12 z-40 border-b border-[var(--border)] bg-[var(--bg-surface)] px-4 py-2"
      onClick={onClose}
    >
      <div className="flex items-baseline gap-2 flex-wrap">
        {tags.map((t, i) => (
          <span key={t.label} className="inline-flex items-baseline gap-2">
            {i > 0 && SEP}
            <Tag label={t.label} value={t.value} />
          </span>
        ))}
      </div>
    </div>
  );
}
