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

export function InfoPanel({ status, connected, onClose }: InfoPanelProps) {
  if (!status) return null;

  const bd = status.contextBreakdown;

  return (
    <div
      className="absolute left-0 right-0 top-12 z-40 border-b border-[var(--border)] bg-[var(--bg-surface)] px-4 py-2"
      onClick={onClose}
    >
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <Tag label="model" value={status.model} />
        <Tag label="v" value={status.version} />
        <Tag label="up" value={status.uptime} />
        <Tag label="session" value={status.session} />
        <Tag label="context" value={status.context} />
        {bd && <Tag label="msgs" value={`${bd.messageCount} · ${bd.messageTokens.toLocaleString()}t`} />}
        {bd?.summaryTokens ? <Tag label="summary" value={`${bd.summaryTokens.toLocaleString()}t`} /> : null}
        <Tag label="api" value={status.apiUsage} />
        <Tag label="cache" value={status.cacheUsage} />
        <Tag label="tools" value={status.toolScope} />
        <Tag label="queue" value={status.queue} />
        <Tag label="recall" value={status.recall} />
        <Tag label="tg" value={status.telegram} />
        <Tag label="slack" value={status.slack} />
        <Tag label="hub" value={status.hub} />
      </div>
    </div>
  );
}
