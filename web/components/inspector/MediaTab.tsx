"use client";

import { useState, useEffect } from "react";
import * as api from "../../lib/api";
import { renderMarkdown } from "../../lib/markdown";
import { TabProps, accent, StatCard, ActionBtn, EmptyState } from "./shared";

const FILE_ICONS: Record<string, string> = {
  "application/pdf": "📄",
  "text/csv": "📊",
  "audio/mp3": "🎵",
  "audio/ogg": "🎵",
  "audio/wav": "🎵",
  "video/mp4": "🎬",
};

function formatBytes(bytes: number) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1048576).toFixed(1) + " MB";
}

export function MediaTab({ agentName, token, serverUrl }: TabProps) {
  const [data, setData] = useState<{ files: any[]; stats: any } | null>(null);
  const [filter, setFilter] = useState<"all" | "images" | "documents">("all");
  const [selected, setSelected] = useState<any>(null);

  useEffect(() => {
    api.getMediaList(agentName, token, serverUrl)
      .then((d) => setData(d || { files: [], stats: {} }))
      .catch(() => setData({ files: [], stats: {} }));
  }, [agentName, token, serverUrl]);

  if (!data) return <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading...</div>;

  const s = data.stats || {};
  const files = data.files || [];
  const filtered = filter === "images"
    ? files.filter((m: any) => m.mimeType?.startsWith("image/"))
    : filter === "documents"
    ? files.filter((m: any) => !m.mimeType?.startsWith("image/"))
    : files;

  const mediaUrl = (file: string) => {
    const base = serverUrl ? `${serverUrl}/api/agents/${agentName}` : `/api/agents/${agentName}`;
    return `${base}/media/${file}${token ? "?token=" + encodeURIComponent(token) : ""}`;
  };

  return (
    <div>
      {/* Stats */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <StatCard label="Files" value={s.total || 0} />
        <StatCard label="Images" value={s.images || 0} />
        <StatCard label="Digested" value={`${s.digested || 0}/${s.images || 0}`} />
        <StatCard label="Storage" value={formatBytes(s.totalSize || 0)} />
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        <ActionBtn active={filter === "all"} onClick={() => setFilter("all")}>All</ActionBtn>
        <ActionBtn active={filter === "images"} onClick={() => setFilter("images")}>Images</ActionBtn>
        <ActionBtn active={filter === "documents"} onClick={() => setFilter("documents")}>Documents</ActionBtn>
      </div>

      {filtered.length === 0 && <EmptyState text="No media files" />}

      {/* Detail panel */}
      {selected && (
        <div style={{
          background: "var(--bg-sidebar)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: 16,
          marginBottom: 16,
        }}>
          {selected.mimeType?.startsWith("image/") && (
            <img
              src={mediaUrl(selected.file)}
              alt=""
              style={{ maxWidth: "100%", maxHeight: 300, borderRadius: 6, marginBottom: 12 }}
            />
          )}
          <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
            {/* Metadata */}
            <div style={{ flex: "0 0 220px", fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6 }}>
              {[
                ["Original", selected.originalName || selected.file],
                ["Hash", selected.file],
                ["Type", selected.mimeType],
                ["Size", formatBytes(selected.size || 0)],
                ["Saved", selected.timestamp ? new Date(selected.timestamp).toLocaleString() : "—"],
                ...(selected.describedBy ? [["Model", selected.describedBy]] : []),
                ...(selected.mimeType?.startsWith("image/") ? [["Digest", selected.description ? "✓ cached" : "✗ pending"]] : []),
              ].map(([label, value], i) => (
                <div key={i} style={{ marginBottom: 6 }}>
                  <div style={{ fontSize: 10, textTransform: "uppercase" as const, letterSpacing: 0.5, color: "var(--text-muted)", marginBottom: 1 }}>
                    {label}
                  </div>
                  <div style={{ color: "var(--text)", wordBreak: "break-all" as const, fontFamily: label === "Hash" ? "var(--font-mono)" : undefined, fontSize: label === "Hash" ? 12 : undefined }}>
                    {value}
                  </div>
                </div>
              ))}
            </div>
            {/* Description */}
            {selected.description && (
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: 13,
                  color: "var(--text)",
                  lineHeight: 1.5,
                  padding: "10px 12px",
                  background: "var(--bg)",
                  borderRadius: 6,
                  overflowY: "auto",
                  maxHeight: 300,
                }}
                className="markdown-body"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(selected.description) }}
              />
            )}
          </div>
        </div>
      )}

      {/* Grid */}
      {filtered.length > 0 && (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
          gap: 12,
        }}>
          {filtered.map((item: any) => {
            const isImage = item.mimeType?.startsWith("image/");
            const icon = FILE_ICONS[item.mimeType] || "📎";
            const isActive = selected?.file === item.file;
            const date = item.timestamp ? new Date(item.timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
            return (
              <div
                key={item.file}
                onClick={() => setSelected(isActive ? null : item)}
                style={{
                  background: "var(--bg-sidebar)",
                  border: `1px solid ${isActive ? accent : "var(--border)"}`,
                  borderRadius: 8,
                  overflow: "hidden",
                  cursor: "pointer",
                  transition: "border-color 0.15s",
                  boxShadow: isActive ? `0 0 0 1px ${accent}` : "none",
                }}
              >
                <div style={{
                  width: "100%",
                  height: 120,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "var(--bg)",
                  overflow: "hidden",
                }}>
                  {isImage ? (
                    <img src={mediaUrl(item.file)} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <span style={{ fontSize: 32, opacity: 0.5 }}>{icon}</span>
                  )}
                </div>
                <div style={{ padding: "8px 10px" }}>
                  <div style={{
                    fontSize: 12, color: "var(--text)",
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }} title={item.originalName || item.file}>
                    {item.originalName || item.file}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2, fontFamily: "var(--font-mono)" }}>
                    {formatBytes(item.size || 0)}{date ? ` · ${date}` : ""}
                  </div>
                  {isImage && (
                    <span style={{
                      display: "inline-block",
                      fontSize: 9,
                      padding: "1px 5px",
                      borderRadius: 3,
                      marginTop: 4,
                      fontFamily: "var(--font-mono)",
                      textTransform: "uppercase" as const,
                      letterSpacing: 0.3,
                      background: item.description ? "rgba(252, 213, 58, 0.15)" : "rgba(255,255,255,0.05)",
                      color: item.description ? accent : "var(--text-muted)",
                    }}>
                      {item.description ? "digested" : "pending"}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
