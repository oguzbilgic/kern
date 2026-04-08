// Minimal Markdown → HTML renderer (ported from legacy)

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inline(text: string): string {
  return text
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label: string, url: string) => {
      if (/^https?:\/\//i.test(url)) return `<a href="${url}" target="_blank" rel="noopener">${label}</a>`;
      return `${label} (${url})`;
    })
    .replace(/(^|[^"'>])(https?:\/\/[^\s<]+[^\s<.,;:!?\)\]'"])/g,
      '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
}

export function renderMarkdown(text: string): string {
  if (!text) return "";
  let src = escapeHtml(text);

  const codeBlocks: string[] = [];
  src = src.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang: string, code: string) => {
    const raw = code.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    codeBlocks.push(`<pre><code class="hljs${lang ? ` language-${lang}` : ""}">${escapeHtml(raw)}</code></pre>`);
    return `\x00CB${codeBlocks.length - 1}\x00`;
  });

  const lines = src.split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const cbMatch = line.match(/^\x00CB(\d+)\x00$/);
    if (cbMatch) { out.push(codeBlocks[parseInt(cbMatch[1])]); i++; continue; }

    const hMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (hMatch) { out.push(`<h${hMatch[1].length}>${inline(hMatch[2])}</h${hMatch[1].length}>`); i++; continue; }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) { out.push("<hr>"); i++; continue; }

    if (/^&gt;\s?/.test(line)) {
      const bq: string[] = [];
      while (i < lines.length && /^&gt;\s?/.test(lines[i])) { bq.push(lines[i].replace(/^&gt;\s?/, "")); i++; }
      out.push(`<blockquote>${renderMarkdown(bq.join("\n"))}</blockquote>`);
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^[-*]\s+/, "")); i++; }
      out.push("<ul>" + items.map((li) => `<li>${inline(li)}</li>`).join("") + "</ul>");
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\d+\.\s+/, "")); i++; }
      out.push("<ol>" + items.map((li) => `<li>${inline(li)}</li>`).join("") + "</ol>");
      continue;
    }

    if (/^\|.+\|$/.test(line.trim())) {
      const rows: string[] = [];
      while (i < lines.length && /^\|.+\|$/.test(lines[i].trim())) { rows.push(lines[i]); i++; }
      if (rows.length >= 2) {
        const header = rows[0].split("|").filter(c => c.trim()).map(c => `<th>${inline(c.trim())}</th>`).join("");
        const body = rows.slice(2).map(r => `<tr>${r.split("|").filter(c => c.trim()).map(c => `<td>${inline(c.trim())}</td>`).join("")}</tr>`).join("");
        out.push(`<table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`);
      } else { out.push(inline(line)); }
      continue;
    }

    if (line.trim() === "") { out.push(""); i++; continue; }
    out.push(inline(line));
    i++;
  }

  let html = out.join("<br>")
    .replace(/(<br>){3,}/g, "<br><br>")
    .replace(/<br>(<\/?(?:pre|ul|ol|li|blockquote|h[1-6]|hr|table|thead|tbody|tr|th|td))/g, "$1")
    .replace(/(<\/(?:pre|ul|ol|li|blockquote|h[1-6]|hr|table|thead|tbody|tr|th|td)>)<br>/g, "$1");

  html = html.replace(/\x00CB(\d+)\x00/g, (_, idx) => codeBlocks[parseInt(idx)] || "");
  return html;
}
