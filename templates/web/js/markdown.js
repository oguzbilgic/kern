// ==========================================================================
// Markdown (minimal)
// ==========================================================================

// Parse user messages from history — strips [via ...] metadata prefix
function parseHistoryUserMessage(content) {
const match = content.match(/^\[via ([^,]+),?\s*([^,]*),?\s*user:\s*([^,\]]*),?\s*(?:time:\s*([^\]]*))?\]\n?([\s\S]*)$/);
if (match) {
  const [, iface, channel, userId, time, text] = match;
  const cleanText = (text || '').trim() || '(empty)';
  const timestamp = time ? time.trim() : null;
  // TUI and web messages are the operator
  if (iface.trim() === 'tui') return { type: 'user', text: cleanText, timestamp, iface: 'tui' };
  if (iface.trim() === 'web') return { type: 'user', text: cleanText, timestamp, iface: 'web' };
  // Heartbeat
  if (iface.trim() === 'system') return { type: 'heartbeat', text: '', iface: 'heartbeat' };
  // Other interfaces (telegram, slack)
  return { type: 'incoming', text: cleanText, meta: `[${iface.trim()} ${userId.trim()}]`, timestamp, iface: 'incoming' };
}
if (content === '[heartbeat]' || content.startsWith('[heartbeat')) return { type: 'heartbeat', text: '', iface: 'heartbeat' };
return { type: 'user', text: content };
}

function renderMarkdown(text) {
if (!text) return '';

// Escape HTML
let src = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Extract code blocks first to protect them
const codeBlocks = [];
src = src.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
  const idx = codeBlocks.length;
  // hljs.highlight expects raw text and does its own escaping
  const raw = code.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  let highlighted = code; // fallback: keep HTML-escaped
  if (typeof hljs !== 'undefined') {
    highlighted = lang && hljs.getLanguage(lang)
      ? hljs.highlight(raw, { language: lang }).value
      : hljs.highlightAuto(raw).value;
  }
  codeBlocks.push(`<pre><code class="hljs${lang ? ` language-${lang}` : ''}">${highlighted}</code></pre>`);
  return `\x00CODEBLOCK${idx}\x00`;
});

// Process block elements line by line
const lines = src.split('\n');
const out = [];
let i = 0;

while (i < lines.length) {
  const line = lines[i];

  // Code block placeholder (may appear as entire line or inline)
  const cbMatch = line.match(/^\x00CODEBLOCK(\d+)\x00$/);
  if (cbMatch) { out.push(codeBlocks[parseInt(cbMatch[1])]); i++; continue; }

  // Headers
  const hMatch = line.match(/^(#{1,6})\s+(.+)$/);
  if (hMatch) { const lvl = hMatch[1].length; out.push(`<h${lvl}>${inline(hMatch[2])}</h${lvl}>`); i++; continue; }

  // Horizontal rule
  if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) { out.push('<hr>'); i++; continue; }

  // Blockquote (collect consecutive > lines)
  if (/^&gt;\s?/.test(line)) {
    const bqLines = [];
    while (i < lines.length && /^&gt;\s?/.test(lines[i])) {
      bqLines.push(lines[i].replace(/^&gt;\s?/, ''));
      i++;
    }
    out.push(`<blockquote>${renderMarkdown(bqLines.join('\n'))}</blockquote>`);
    continue;
  }

  // Unordered list (collect consecutive - or * lines)
  if (/^[\-\*]\s+/.test(line)) {
    const items = [];
    while (i < lines.length && /^[\-\*]\s+/.test(lines[i])) {
      items.push(lines[i].replace(/^[\-\*]\s+/, ''));
      i++;
    }
    out.push('<ul>' + items.map(li => `<li>${inline(li)}</li>`).join('') + '</ul>');
    continue;
  }

  // Ordered list (collect consecutive 1. 2. lines)
  if (/^\d+\.\s+/.test(line)) {
    const items = [];
    while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
      items.push(lines[i].replace(/^\d+\.\s+/, ''));
      i++;
    }
    out.push('<ol>' + items.map(li => `<li>${inline(li)}</li>`).join('') + '</ol>');
    continue;
  }

  // Table (| ... | rows)
  if (/^\|.+\|$/.test(line.trim())) {
    const rows = [];
    while (i < lines.length && /^\|.+\|$/.test(lines[i].trim())) {
      rows.push(lines[i]);
      i++;
    }
    if (rows.length >= 2) {
      const header = rows[0].split('|').filter(c => c.trim()).map(c => `<th>${inline(c.trim())}</th>`).join('');
      // Skip separator row (row 1)
      const body = rows.slice(2).map(r => {
        const cells = r.split('|').filter(c => c.trim()).map(c => `<td>${inline(c.trim())}</td>`).join('');
        return `<tr>${cells}</tr>`;
      }).join('');
      out.push(`<table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`);
    } else {
      out.push(inline(line));
    }
    continue;
  }

  // Empty line
  if (line.trim() === '') { out.push(''); i++; continue; }

  // Plain paragraph
  out.push(inline(line));
  i++;
}

// Join with <br> for single newlines, collapse empty lines
let html = out.join('<br>').replace(/(<br>){3,}/g, '<br><br>').replace(/<br>(<\/?(?:pre|ul|ol|li|blockquote|h[1-6]|hr|table|thead|tbody|tr|th|td))/g, '$1').replace(/(<\/(?:pre|ul|ol|li|blockquote|h[1-6]|hr|table|thead|tbody|tr|th|td)>)<br>/g, '$1');

// Restore any code block placeholders that weren't on their own line
html = html.replace(/\x00CODEBLOCK(\d+)\x00/g, (_, idx) => codeBlocks[parseInt(idx)] || '');

return html;
}

function inline(text) {
return text
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/\*(.+?)\*/g, '<em>$1</em>')
  .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
    // Only allow http/https links
    if (/^https?:\/\//i.test(url)) {
      return `<a href="${url}" target="_blank" rel="noopener">${label}</a>`;
    }
    return `${label} (${url})`;
  })
  // Auto-link bare URLs not already inside an <a> tag
  .replace(/(^|[^"'>])(https?:\/\/[^\s<]+[^\s<.,;:!?\)\]'"])/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
}

