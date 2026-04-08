import type { StatusData } from "../lib/types";

interface InfoPanelProps {
  status: StatusData | null;
  connected: boolean;
  onClose: () => void;
}

function Row({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex justify-between items-baseline py-1.5 border-b border-[var(--border)]">
      <span className="text-xs text-[var(--text-muted)]">{label}</span>
      <span className="text-xs text-[var(--text)] font-mono ml-4 text-right">{value}</span>
    </div>
  );
}

export function InfoPanel({ status, connected, onClose }: InfoPanelProps) {
  if (!status) return null;

  const bd = status.contextBreakdown;

  return (
    <div
      className="border-b border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3 animate-in"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="max-w-lg">
        <Row label="Status" value={connected ? "Connected" : "Disconnected"} />
        <Row label="Model" value={status.model} />
        <Row label="Version" value={status.version} />
        <Row label="Uptime" value={status.uptime} />
        <Row label="Session" value={status.session} />
        <Row label="Context" value={status.context} />
        {bd && (
          <>
            <Row label="System prompt" value={bd.systemPromptTokens ? `${bd.systemPromptTokens.toLocaleString()} tokens` : undefined} />
            <Row label="Summary" value={bd.summaryTokens ? `${bd.summaryTokens.toLocaleString()} tokens` : undefined} />
            <Row label="Messages" value={`${bd.messageCount} msgs · ${bd.messageTokens.toLocaleString()} tokens`} />
          </>
        )}
        <Row label="API usage" value={status.apiUsage} />
        <Row label="Cache" value={status.cacheUsage} />
        <Row label="Tool scope" value={status.toolScope} />
        <Row label="Queue" value={status.queue} />
        <Row label="Recall" value={status.recall} />
        <Row label="Telegram" value={status.telegram} />
        <Row label="Slack" value={status.slack} />
        <Row label="Hub" value={status.hub} />
        {status.hubId && <Row label="Hub ID" value={status.hubId} />}
      </div>
    </div>
  );
}
