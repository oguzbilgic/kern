// ==========================================================================
// Unified Inspector Overlay
// ==========================================================================

const inspectorOverlay = $('inspector-overlay');
const inspectorTitle = $('inspector-title');
const inspectorStats = $('inspector-stats');
const inspectorActions = $('inspector-actions');
$('messages-scroll').addEventListener('click', () => { infoPanel.classList.remove('open'); });

const segTimeline = $('segments-timeline');
const promptText = $('prompt-text');
const promptStructured = $('prompt-structured');
let promptViewMode = 'structured';
let inspectorTab = 'sessions';

const INSPECTOR_TAB_TITLES = {
sessions: 'Sessions',
recall: 'Recall',
notes: 'Notes',
segments: 'Segments',
media: 'Media',
context: 'Context',
};

function updateInspectorTab() {
// Update tab buttons
['sessions', 'recall', 'notes', 'segments', 'media', 'context'].forEach(t => {
  $('inspector-tab-' + t).classList.toggle('active', inspectorTab === t);
  $('inspector-content-' + t).classList.toggle('active', inspectorTab === t);
});
inspectorTitle.textContent = 'Memory';
inspectorStats.textContent = INSPECTOR_TAB_TITLES[inspectorTab];

// Build actions per tab — left: filters/toggles, right: action buttons
let leftHtml = '';
let rightHtml = '';
if (inspectorTab === 'notes') {
  rightHtml = '<button class="action-btn" id="notes-regenerate"><span class="action-icon">↻</span> Regenerate</button>';
} else if (inspectorTab === 'segments') {
  leftHtml = [
    '<button class="action-btn' + (segmentFilterMode === 'all' ? ' active' : '') + '" id="segments-filter-all">All</button>',
    '<button class="action-btn' + (segmentFilterMode === 'context' ? ' active' : '') + '" id="segments-filter-context">In context</button>',
  ].join('');
  rightHtml = [
    '<button class="action-btn" id="segments-start"><span class="action-icon">▶</span> Start</button>',
    '<button class="action-btn" id="segments-stop"><span class="action-icon">■</span> Stop</button>',
    '<button class="action-btn" id="segments-rebuild"><span class="action-icon">↻</span> Rebuild</button>',
    '<button class="action-btn danger" id="segments-clean"><span class="action-icon">✕</span> Clean</button>',
  ].join('');
} else if (inspectorTab === 'media') {
  leftHtml = [
    '<button class="action-btn' + (mediaFilter === 'all' ? ' active' : '') + '" id="media-filter-all">All</button>',
    '<button class="action-btn' + (mediaFilter === 'images' ? ' active' : '') + '" id="media-filter-images">Images</button>',
    '<button class="action-btn' + (mediaFilter === 'documents' ? ' active' : '') + '" id="media-filter-documents">Documents</button>',
  ].join('');
} else if (inspectorTab === 'context') {
  leftHtml = [
    '<button class="action-btn' + (promptViewMode === 'structured' ? ' active' : '') + '" id="prompt-mode-structured">Structured</button>',
    '<button class="action-btn' + (promptViewMode === 'raw' ? ' active' : '') + '" id="prompt-mode-raw">Raw</button>',
  ].join('');
  rightHtml = '<button class="action-btn" id="prompt-refresh"><span class="action-icon">↻</span> Refresh</button>';
}
const actionsHtml = (leftHtml || rightHtml) ? '<div class="toolbar-left">' + leftHtml + '</div><div class="toolbar-right">' + rightHtml + '</div>' : '';
inspectorActions.innerHTML = actionsHtml;
$('inspector-toolbar').style.display = actionsHtml ? '' : 'none';

// Re-bind dynamic action buttons
if (inspectorTab === 'notes') {
  $('notes-regenerate').addEventListener('click', async () => {
    const btn = $('notes-regenerate');
    btn.textContent = 'Regenerating...';
    btn.disabled = true;
    try { await AgentClient.regenerateSummary(BASE_URL, AUTH_TOKEN); await fetchSummaries(); }
    catch (e) { console.error('regenerate failed:', e); }
    finally { btn.textContent = 'Regenerate'; btn.disabled = false; }
  });
} else if (inspectorTab === 'segments') {
  $('segments-filter-all').addEventListener('click', async () => { segmentFilterMode = 'all'; updateInspectorTab(); await fetchAndRenderSegments(); });
  $('segments-filter-context').addEventListener('click', async () => { segmentFilterMode = 'context'; updateInspectorTab(); await fetchAndRenderSegments(); });
  $('segments-start').addEventListener('click', async () => {
    if (!BASE_URL) return;
    try { await fetch(`${BASE_URL}/segments/start`, { method: 'POST', headers: AgentClient._headers(AUTH_TOKEN) }); inspectorStats.textContent = 'indexing...'; } catch (e) { console.error('start failed:', e); }
  });
  $('segments-stop').addEventListener('click', async () => {
    if (!BASE_URL) return;
    try { await fetch(`${BASE_URL}/segments/stop`, { method: 'POST', headers: AgentClient._headers(AUTH_TOKEN) }); inspectorStats.textContent = 'stopped'; } catch (e) { console.error('stop failed:', e); }
  });
  $('segments-clean').addEventListener('click', async () => {
    if (!BASE_URL) return;
    if (!confirm('Clean all segments?')) return;
    try { await fetch(`${BASE_URL}/segments/clean`, { method: 'POST', headers: AgentClient._headers(AUTH_TOKEN) }); inspectorStats.textContent = 'cleaned'; segTimeline.innerHTML = ''; } catch (e) { console.error('clean failed:', e); }
  });
  $('segments-rebuild').addEventListener('click', async () => {
    if (!BASE_URL) return;
    if (!confirm('Rebuild segments from scratch?')) return;
    const btn = $('segments-rebuild');
    btn.textContent = 'Rebuilding...'; btn.disabled = true;
    try { await fetch(`${BASE_URL}/segments/rebuild`, { method: 'POST', headers: AgentClient._headers(AUTH_TOKEN) }); inspectorStats.textContent = 'rebuilding...'; segTimeline.innerHTML = '<div style="color:var(--text-muted);padding:20px;">Rebuild started. Refresh in a minute.</div>'; }
    catch (e) { console.error('rebuild failed:', e); }
    finally { btn.textContent = 'Rebuild'; btn.disabled = false; }
  });
} else if (inspectorTab === 'media') {
  $('media-filter-all').addEventListener('click', () => { mediaFilter = 'all'; updateInspectorTab(); renderMediaGrid(); });
  $('media-filter-images').addEventListener('click', () => { mediaFilter = 'images'; updateInspectorTab(); renderMediaGrid(); });
  $('media-filter-documents').addEventListener('click', () => { mediaFilter = 'documents'; updateInspectorTab(); renderMediaGrid(); });
} else if (inspectorTab === 'context') {
  $('prompt-mode-structured').addEventListener('click', () => { promptViewMode = 'structured'; updatePromptModeButtons(); });
  $('prompt-mode-raw').addEventListener('click', () => { promptViewMode = 'raw'; updatePromptModeButtons(); });
  $('prompt-refresh').addEventListener('click', fetchAndRenderPrompt);
}
}

function openInspector(tab) {
inspectorTab = tab || 'sessions';
const agentLabel = document.getElementById('inspector-agent-name');
if (agentLabel) agentLabel.textContent = getActiveAgent() || '';
updateInspectorTab();
inspectorOverlay.classList.add('open');
// Load data for the active tab
loadInspectorTabData();
}

function closeInspector() {
inspectorOverlay.classList.remove('open');
if (segPollTimer) { clearInterval(segPollTimer); segPollTimer = null; }
}

async function loadInspectorTabData() {
if (segPollTimer) { clearInterval(segPollTimer); segPollTimer = null; }
if (inspectorTab === 'sessions') { await fetchSessions(); }
else if (inspectorTab === 'recall') { await fetchRecallStats(); $('recall-search-input').focus(); }
else if (inspectorTab === 'notes') { await fetchSummaries(); }
else if (inspectorTab === 'segments') { await fetchAndRenderSegments(); segPollTimer = setInterval(fetchAndRenderSegments, 3000); }
else if (inspectorTab === 'media') { await fetchMediaList(); renderMediaGrid(); }
else if (inspectorTab === 'context') { await fetchAndRenderPrompt(); }
}

$('inspector-btn').addEventListener('click', () => {
if (inspectorOverlay.classList.contains('open')) { closeInspector(); return; }
openInspector('sessions');
});

$('inspector-close').addEventListener('click', closeInspector);
inspectorOverlay.addEventListener('click', (e) => { if (e.target === inspectorOverlay) closeInspector(); });

['sessions', 'recall', 'notes', 'segments', 'media', 'context'].forEach(t => {
$('inspector-tab-' + t).addEventListener('click', async () => {
  inspectorTab = t;
  updateInspectorTab();
  await loadInspectorTabData();
});
});


// Color encodes token density (tokens/message) — cool to warm
function segColor(tokens, span) {
const density = span > 0 ? tokens / span : 0;
// Clamp density to 0-1000 range, map to hue 210 (blue) → 0 (red)
const t = Math.min(1, density / 1000);
const hue = 210 - t * 210;
return `hsl(${hue}, 60%, 45%)`;
}

let segPollTimer = null;

async function fetchAndRenderSegments() {
if (!BASE_URL) return;
try {
  const [res, contextData] = await Promise.all([
    fetch(`${BASE_URL}/segments`, { headers: AgentClient._headers(AUTH_TOKEN) }),
    AgentClient.getContextSegments(BASE_URL, AUTH_TOKEN).catch(() => ({ segments: [] })),
  ]);
  if (!res.ok) return;
  const data = await res.json();
  contextSegmentIds = new Set((contextData.segments || []).map(s => s.id));
  renderSegments(data);
} catch (e) {
  console.error('segments fetch failed:', e);
}
}



const SECTION_COLORS = {
document: '#e5b567',
notes_summary: '#8b5cf6',
tools: '#f59e0b',
conversation_summary: '#10b981',
summary: '#10b981',
unknown: '#6b7280',
};

function parsePromptSections(text) {
const sections = [];
let pos = 0;
// Match top-level XML-like tags
const tagRe = /<(document|notes_summary|tools|conversation_summary)\b([^>]*)>([\s\S]*?)<\/\1>/g;
let m;
while ((m = tagRe.exec(text)) !== null) {
  // Capture any text before this tag as "unknown"
  if (m.index > pos) {
    const before = text.slice(pos, m.index).trim();
    if (before) sections.push({ type: 'unknown', label: 'Text', attrs: {}, content: before });
  }
  const type = m[1];
  const attrStr = m[2];
  let content = m[3];

  // Parse attributes
  const attrs = {};
  const attrRe = /(\w+)="([^"]*)"/g;
  let am;
  while ((am = attrRe.exec(attrStr)) !== null) attrs[am[1]] = am[2];

  // For conversation_summary, parse child <summary> blocks
  let children = null;
  if (type === 'conversation_summary') {
    children = [];
    const sumRe = /<summary\b([^>]*)>([\s\S]*?)<\/summary>/g;
    let sm;
    while ((sm = sumRe.exec(content)) !== null) {
      const sAttrs = {};
      const saRe = /(\w+)="([^"]*)"/g;
      let sa;
      while ((sa = saRe.exec(sm[1])) !== null) sAttrs[sa[1]] = sa[2];
      children.push({ attrs: sAttrs, content: sm[2].trim() });
    }
  }

  let label = type;
  if (type === 'document') label = attrs.path || 'document';
  else if (type === 'notes_summary') label = 'Notes Summary';
  else if (type === 'tools') label = 'Tools';
  else if (type === 'conversation_summary') label = 'Conversation Summary';

  sections.push({ type, label, attrs, content: content.trim(), children });
  pos = m.index + m[0].length;
}
// Trailing text
if (pos < text.length) {
  const after = text.slice(pos).trim();
  if (after) sections.push({ type: 'unknown', label: 'Text', attrs: {}, content: after });
}
return sections;
}

function tokEst(text) { return Math.ceil((text || '').length / 3.3); }

function renderPromptStructured(text, status) {
const sections = parsePromptSections(text);
const systemTokens = tokEst(text);
const cb = status?.contextBreakdown;

// Use real token counts from contextBreakdown
// conversation_summary is already inside the system prompt text, so don't double-count
const msgTokens = cb ? cb.messageTokens : 0;
const summaryTokens = cb ? cb.summaryTokens : 0;
// System prompt estimate minus the summary portion (which is tracked separately)
const summarySectionTokens = sections.filter(s => s.type === 'conversation_summary').reduce((sum, s) => sum + tokEst(s.content), 0);
const pureSystemTokens = systemTokens - summarySectionTokens;
const totalContextTokens = pureSystemTokens + summaryTokens + msgTokens;

// Count messages from the DOM
const msgContainer = $('messages');
const domMsgs = msgContainer ? msgContainer.querySelectorAll('.message') : [];
const msgCount = domMsgs.length;
const roleCounts = {};
domMsgs.forEach(el => {
  const cls = el.className.split(/\s+/);
  const type = cls[1] || 'unknown';
  roleCounts[type] = (roleCounts[type] || 0) + 1;
});
// Find first/last timestamps from DOM
const allTs = msgContainer ? msgContainer.querySelectorAll('.timestamp') : [];
const firstTs = allTs.length > 0 ? allTs[0].textContent.trim() : '';
const lastTs = allTs.length > 0 ? allTs[allTs.length - 1].textContent.trim() : '';

// Size bar — include messages segment
const allSegments = [...sections.map(s => ({ ...s, tokens: tokEst(s.content) }))];
if (msgTokens > 0) allSegments.push({ type: 'messages', label: 'Messages', tokens: msgTokens });
const barTotal = totalContextTokens || allSegments.reduce((s, x) => s + x.tokens, 0);

const sizeBar = allSegments.map(s => {
  const pct = barTotal > 0 ? (s.tokens / barTotal * 100) : 0;
  if (pct < 1) return '';
  const color = s.type === 'messages' ? '#e5534b' : (SECTION_COLORS[s.type] || SECTION_COLORS.unknown);
  const shortLabel = s.type === 'document' ? (s.attrs?.path || '').split('/').pop() : s.label;
  return `<div class="prompt-size-bar-segment" style="width:${pct}%;background:${color};" title="${escapeHtml(s.label)}: ~${s.tokens.toLocaleString()} tokens (${pct.toFixed(1)}%)">${pct > 6 ? escapeHtml(shortLabel) : ''}</div>`;
}).join('');

// Section cards
const cards = sections.map((s, i) => {
  const tokens = tokEst(s.content);
  const color = SECTION_COLORS[s.type] || SECTION_COLORS.unknown;
  let bodyContent = '';

  if (s.type === 'conversation_summary' && s.children && s.children.length > 0) {
    bodyContent = s.children.map(c => {
      const cTokens = tokEst(c.content);
      const level = c.attrs.level || '?';
      const msgs = c.attrs.messages || '';
      const first = c.attrs.first ? new Date(c.attrs.first).toLocaleString() : '';
      const last = c.attrs.last ? new Date(c.attrs.last).toLocaleString() : '';
      const timeRange = first && last ? ` · ${first} → ${last}` : first ? ` · from ${first}` : '';
      return `<div class="prompt-summary-card">
        <div class="prompt-summary-card-meta">${level} · msgs ${msgs} · ~${cTokens.toLocaleString()} tokens${timeRange}</div>
        <div class="summary-text prompt-markdown" onclick="this.classList.toggle('expanded')">${renderMarkdown(c.content)}</div>
      </div>`;
    }).join('');
  } else {
    bodyContent = `<div class="prompt-markdown">${renderMarkdown(s.content)}</div>`;
  }

  return `<div class="prompt-section type-${s.type}">
    <div class="prompt-section-header" onclick="const b=this.nextElementSibling;b.classList.toggle('open');this.querySelector('.icon').classList.toggle('open');">
      <div class="prompt-section-title"><span class="icon">&#9656;</span>${escapeHtml(s.label)}</div>
      <div class="prompt-section-meta">~${tokens.toLocaleString()} tokens · ${s.content.length.toLocaleString()} chars</div>
    </div>
    <div class="prompt-section-body">${bodyContent}</div>
  </div>`;
}).join('');

// Messages card — use real breakdown data
const statusMsgCount = cb ? cb.messageCount : msgCount;
const trimmedCount = cb ? cb.trimmedCount : null;
const roleStr = Object.entries(roleCounts).map(([k, v]) => `${k}: ${v}`).join(' · ');
const timeStr = firstTs && lastTs ? `${firstTs} → ${lastTs}` : firstTs || lastTs || '';
const messagesCard = `<div class="prompt-section type-unknown" style="border-left-color:#e5534b;">
  <div class="prompt-section-header" style="border-left:3px solid #e5534b;cursor:default;">
    <div class="prompt-section-title">Raw Messages</div>
    <div class="prompt-section-meta">~${msgTokens.toLocaleString()} tokens · ${statusMsgCount.toLocaleString()} messages${trimmedCount ? ` · ${trimmedCount.toLocaleString()} trimmed` : ''}</div>
  </div>
  <div class="prompt-section-body open" style="padding:10px 14px;">
    <div style="font-size:12px;color:var(--text-muted);font-family:var(--font-mono);line-height:1.8;">
      ${roleStr ? `<div>${roleStr}</div>` : ''}
      ${timeStr ? `<div>${timeStr}</div>` : ''}
    </div>
  </div>
</div>`;

return `<div class="prompt-size-bar">${sizeBar}</div>${cards}${messagesCard}`;
}

function updatePromptModeButtons() {
const s = document.getElementById('prompt-mode-structured');
const r = document.getElementById('prompt-mode-raw');
if (s) s.classList.toggle('active', promptViewMode === 'structured');
if (r) r.classList.toggle('active', promptViewMode === 'raw');
promptStructured.style.display = promptViewMode === 'structured' ? 'block' : 'none';
promptText.style.display = promptViewMode === 'raw' ? 'block' : 'none';
}

async function fetchAndRenderPrompt() {
if (!BASE_URL) return;
try {
  const [text, status] = await Promise.all([
    AgentClient.getSystemPrompt(BASE_URL, AUTH_TOKEN),
    fetch(`${BASE_URL}/status`, { headers: AgentClient._headers(AUTH_TOKEN) }).then(r => r.json()).catch(() => null),
  ]);
  promptText.textContent = text;
  promptStructured.innerHTML = renderPromptStructured(text, status);
  const cb = status?.contextBreakdown;
  // Summary tokens: use real count from backend, fallback to char estimate
  const sumSectionChars = (text.match(/<conversation_summary\b[^>]*>([\s\S]*?)<\/conversation_summary>/)?.[0] || '').length;
  const sumTokens = cb ? cb.summaryTokens : Math.ceil(sumSectionChars / 3.3);
  // System prompt tokens: estimate total text minus summary section, then subtract real summary
  const sysTokens = Math.ceil((text.length - sumSectionChars) / 3.3);
  const msgTokens = cb ? cb.messageTokens : 0;
  const maxTokens = cb ? cb.maxTokens : null;
  const ctxMsgs = cb ? cb.messageCount : '?';
  const trimmed = cb ? cb.trimmedCount : null;
  const total = sysTokens + sumTokens + msgTokens;
  const budgetStr = maxTokens ? ` / ${(maxTokens / 1000).toFixed(0)}k` : '';
  inspectorStats.textContent = `~${Math.round(total / 1000)}k${budgetStr} tokens · system ~${Math.round(sysTokens / 1000)}k · summary ~${Math.round(sumTokens / 1000)}k · messages ~${Math.round(msgTokens / 1000)}k · ${ctxMsgs} msgs${trimmed ? ` · ${trimmed.toLocaleString()} trimmed` : ''}`;
  updatePromptModeButtons();
} catch (e) {
  console.error('prompt fetch failed:', e);
  promptText.textContent = 'Failed to load system prompt';
  promptStructured.innerHTML = '<p>Failed to load system prompt</p>';
  inspectorStats.textContent = '';
  updatePromptModeButtons();
}
}





const memSummariesContent = $('memory-content-summaries');
const memSessionsContent = $('memory-content-sessions');
const recallResults = $('recall-results');
const recallStatsEl = $('recall-stats');
const mediaStatsEl = $('media-stats');
const mediaGridContainer = $('media-grid-container');

// --- Media tab (mock data) ---
let mediaFilter = 'all';
let selectedMediaFile = null;

let mediaData = { files: [], stats: { total: 0, images: 0, digested: 0, totalSize: 0 } };

const FILE_ICONS = {
'application/pdf': '📄',
'text/csv': '📊',
'audio/mp3': '🎵',
'audio/ogg': '🎵',
'audio/wav': '🎵',
'video/mp4': '🎬',
};

function formatBytes(bytes) {
if (bytes < 1024) return bytes + ' B';
if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
return (bytes / 1048576).toFixed(1) + ' MB';
}

function getFilteredMedia() {
const files = mediaData.files || [];
if (mediaFilter === 'images') return files.filter(m => m.mimeType.startsWith('image/'));
if (mediaFilter === 'documents') return files.filter(m => !m.mimeType.startsWith('image/'));
return files;
}

async function fetchMediaList() {
if (!BASE_URL) return;
try {
  const res = await fetch(`${BASE_URL}/media/list`, { headers: AgentClient._headers(AUTH_TOKEN) });
  if (res.ok) mediaData = await res.json();
} catch (e) { console.error('fetchMediaList failed:', e); }
}

function renderMediaGrid() {
const items = getFilteredMedia();
const s = mediaData.stats || {};

mediaStatsEl.style.display = '';
mediaStatsEl.innerHTML = [
  `<div class="recall-stat-card"><div class="v">${s.total || 0}</div><div class="k">Files</div></div>`,
  `<div class="recall-stat-card"><div class="v">${s.images || 0}</div><div class="k">Images</div></div>`,
  `<div class="recall-stat-card"><div class="v">${s.digested || 0}/${s.images || 0}</div><div class="k">Digested</div></div>`,
  `<div class="recall-stat-card"><div class="v">${formatBytes(s.totalSize || 0)}</div><div class="k">Storage</div></div>`,
].join('');

if (items.length === 0) {
  mediaGridContainer.innerHTML = '<div class="recall-empty">No media files</div>';
  return;
}

// Detail panel + grid
let html = '<div class="media-detail" id="media-detail-panel"></div>';
html += '<div class="media-grid">';
for (const item of items) {
  const isImage = item.mimeType.startsWith('image/');
  const icon = FILE_ICONS[item.mimeType] || '📎';
  const date = new Date(item.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const active = selectedMediaFile === item.file ? ' active' : '';
  html += `<div class="media-card${active}" data-file="${item.file}">`;
  html += `<div class="media-card-thumb">`;
  if (isImage) {
    const thumbUrl = mediaProxyUrl(item.file);
    html += `<img src="${thumbUrl}" alt="" loading="lazy" />`;
  } else {
    html += `<span class="file-icon">${icon}</span>`;
  }
  html += `</div>`;
  html += `<div class="media-card-info">`;
  html += `<div class="name" title="${escapeHtml(item.originalName || item.file)}">${escapeHtml(item.originalName || item.file)}</div>`;
  html += `<div class="meta">${formatBytes(item.size)} · ${date}</div>`;
  if (isImage) {
    html += item.description
      ? `<span class="digest-badge digested">digested</span>`
      : `<span class="digest-badge pending">pending</span>`;
  }
  html += `</div></div>`;
}
html += '</div>';
mediaGridContainer.innerHTML = html;

// Card click handlers
mediaGridContainer.querySelectorAll('.media-card').forEach(card => {
  card.addEventListener('click', () => {
    const file = card.dataset.file;
    selectedMediaFile = selectedMediaFile === file ? null : file;
    renderMediaDetail();
    mediaGridContainer.querySelectorAll('.media-card').forEach(c => c.classList.toggle('active', c.dataset.file === selectedMediaFile));
  });
});

// Show detail if one is selected
renderMediaDetail();
}

function mediaProxyUrl(file) {
return `${BASE_URL}/media/${file}${AUTH_TOKEN ? '?token=' + encodeURIComponent(AUTH_TOKEN) : ''}`;
}

function renderMediaDetail() {
const panel = document.getElementById('media-detail-panel');
if (!panel) return;
if (!selectedMediaFile) { panel.classList.remove('open'); return; }

const files = mediaData.files || [];
const item = files.find(m => m.file === selectedMediaFile);
if (!item) { panel.classList.remove('open'); return; }

const isImage = item.mimeType.startsWith('image/');
const date = new Date(item.timestamp).toLocaleString();
let html = '';

if (isImage) {
  const imgUrl = mediaProxyUrl(item.file);
  html += `<img class="media-detail-preview" src="${imgUrl}" alt="" />`;
}

html += `<div class="media-detail-columns">`;

// Left: metadata
html += `<div class="media-detail-meta">`;
html += `<div class="meta-row"><span class="meta-label">Original</span><span class="meta-value">${escapeHtml(item.originalName || item.file)}</span></div>`;
html += `<div class="meta-row"><span class="meta-label">Hash</span><span class="meta-value" style="font-family:var(--font-mono);font-size:12px;">${item.file}</span></div>`;
html += `<div class="meta-row"><span class="meta-label">Type</span><span class="meta-value">${item.mimeType}</span></div>`;
html += `<div class="meta-row"><span class="meta-label">Size</span><span class="meta-value">${formatBytes(item.size)}</span></div>`;
html += `<div class="meta-row"><span class="meta-label">Saved</span><span class="meta-value">${date}</span></div>`;
if (item.describedBy) {
  html += `<div class="meta-row"><span class="meta-label">Model</span><span class="meta-value">${escapeHtml(item.describedBy)}</span></div>`;
}
if (isImage) {
  html += `<div class="meta-row"><span class="meta-label">Digest</span><span class="meta-value">${item.description ? '✓ cached' : '✗ pending'}</span></div>`;
}
html += `</div>`;

// Right: description
if (item.description) {
  html += `<div class="media-detail-desc prompt-markdown">${renderMarkdown(item.description)}</div>`;
}

html += `</div>`; // end columns

panel.innerHTML = html;
panel.classList.add('open');
}

function renderSummaries(summaries) {
if (!summaries || summaries.length === 0) {
  memSummariesContent.innerHTML = '<div class="recall-empty">No notes summaries generated yet</div>';
  inspectorStats.textContent = '';
  return;
}
inspectorStats.textContent = `${summaries.length} ${summaries.length === 1 ? 'summary' : 'summaries'}`;
memSummariesContent.innerHTML = summaries.map((s, i) => {
  const isCurrent = i === 0;
  const dateRange = s.date_start && s.date_end ? `${s.date_start} → ${s.date_end}` : '';
  const sourceKey = s.source_key || '';
  const created = s.created_at ? new Date(s.created_at).toLocaleString() : '';
  const chars = s.text ? s.text.length : 0;
  return `<div class="summary-card${isCurrent ? ' current' : ''}">
    <div class="summary-meta">
      <span>${dateRange}${sourceKey ? ` · key: ${sourceKey}` : ''}</span>
      <span>${isCurrent ? '<span class="badge">current</span> · ' : ''}${chars.toLocaleString()} chars${created ? ` · ${created}` : ''}</span>
    </div>
    <div class="summary-text prompt-markdown" onclick="this.classList.toggle('expanded')">${s.text ? renderMarkdown(s.text) : '<span style="color:var(--text-muted);font-style:italic;">(empty)</span>'}</div>
  </div>`;
}).join('');
}

async function fetchSummaries() {
if (!BASE_URL) return;
try {
  const data = await AgentClient.getSummaries(BASE_URL, AUTH_TOKEN);
  renderSummaries(data);
} catch (e) {
  memSummariesContent.innerHTML = '<div class="recall-empty">Failed to load summaries</div>';
}
}

async function fetchRecallStats() {
if (!BASE_URL) return;
try {
  const data = await AgentClient.getRecallStats(BASE_URL, AUTH_TOKEN);
  if (!data.enabled) {
    recallStatsEl.style.display = 'flex';
    recallStatsEl.innerHTML = '<div class="recall-empty" style="width:100%;text-align:center;">Recall is disabled (set recall: true in config)</div>';
    return;
  }
  let dateRange = '';
  if (data.firstTimestamp && data.lastTimestamp) {
    const fmt = ts => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    dateRange = `${fmt(data.firstTimestamp)} — ${fmt(data.lastTimestamp)}`;
  }
  recallStatsEl.style.display = 'flex';
  recallStatsEl.innerHTML = [
    `<div class="recall-stat-card"><div class="v">${(data.messages || 0).toLocaleString()}</div><div class="k">Messages</div></div>`,
    `<div class="recall-stat-card"><div class="v">${(data.chunks || 0).toLocaleString()}</div><div class="k">Chunks</div></div>`,
    `<div class="recall-stat-card"><div class="v">${(data.sessions || 0).toLocaleString()}</div><div class="k">Sessions</div></div>`,
    dateRange ? `<div class="recall-stat-card"><div class="v" style="font-size:13px;">${dateRange}</div><div class="k">Date range</div></div>` : '',
    data.building ? `<div class="recall-stat-card"><div class="v" style="color:var(--ov-accent);">●</div><div class="k">Indexing...</div></div>` : '',
  ].join('');
  // Update subtitle
  $('inspector-stats').textContent = `${(data.messages || 0).toLocaleString()} messages indexed`;
} catch {
  recallStatsEl.style.display = 'none';
}
}

async function doRecallSearch() {
const query = $('recall-search-input').value.trim();
if (!query) return;
const btn = $('recall-search-btn');
btn.textContent = 'Searching...';
btn.disabled = true;
try {
  const data = await AgentClient.recallSearch(BASE_URL, AUTH_TOKEN, query);
  renderRecallResults(data);
} catch (e) {
  recallResults.innerHTML = `<div class="recall-empty">Search failed: ${escapeHtml(e.message)}</div>`;
  recallStatsEl.style.display = 'none';
} finally {
  btn.textContent = 'Search';
  btn.disabled = false;
}
}

function renderRecallResults(data) {
const { results } = data;
if (!results || results.length === 0) {
  recallResults.innerHTML = '<div class="recall-empty">No results found</div>';
  return;
}
recallResults.innerHTML = results.map(r => {
  const dist = typeof r.distance === 'number' ? r.distance.toFixed(3) : '?';
  const barWidth = Math.max(2, Math.round((1 - (r.distance || 0)) * 80));
  const ts = r.timestamp ? new Date(r.timestamp).toLocaleString() : '';
  const msgRange = r.msgStart !== undefined ? `msgs ${r.msgStart}-${r.msgEnd}` : '';
  return `<div class="recall-result">
    <div class="recall-result-meta">
      <span>${ts}${msgRange ? ` · ${msgRange}` : ''}</span>
      <span>distance: ${dist}<span class="distance-bar" style="width:${barWidth}px"></span></span>
    </div>
    <div class="recall-result-text" onclick="this.classList.toggle('expanded')">${escapeHtml(r.text || r.chunk || '(empty)')}</div>
  </div>`;
}).join('');
}

function renderBarChart(data, keyFn, valFn, { width = 600, height = 70, barColor = '#e5b567' } = {}) {
if (!data || data.length === 0) return '<div class="recall-empty" style="padding:10px 0;">No activity data</div>';
const max = Math.max(...data.map(valFn));
const barW = Math.max(2, Math.floor((width - data.length) / data.length));
const gap = 1;
const svgW = data.length * (barW + gap);
const bars = data.map((d, i) => {
  const h = max > 0 ? Math.max(1, (valFn(d) / max) * height) : 0;
  const x = i * (barW + gap);
  const y = height - h;
  return `<rect x="${x}" y="${y}" width="${barW}" height="${h}" fill="${barColor}" rx="1">
    <title>${keyFn(d)}: ${valFn(d)} messages</title>
  </rect>`;
}).join('');
return `<div class="activity-chart"><svg viewBox="0 0 ${svgW} ${height}" preserveAspectRatio="none">${bars}</svg></div>`;
}

function formatDuration(firstTs, lastTs) {
if (!firstTs || !lastTs) return '—';
const ms = new Date(lastTs) - new Date(firstTs);
const days = Math.floor(ms / 86400000);
const hours = Math.floor((ms % 86400000) / 3600000);
if (days > 0) return `${days}d ${hours}h`;
const mins = Math.floor((ms % 3600000) / 60000);
return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

let _sessionsData = [];
let _currentSessionId = null;
let _selectedSessionId = null;

async function fetchSessions() {
if (!BASE_URL) return;
try {
  const data = await AgentClient.getSessions(BASE_URL, AUTH_TOKEN);
  // Handle both old (array) and new ({ sessions, currentSessionId }) response shapes
  if (Array.isArray(data)) {
    _sessionsData = data;
    _currentSessionId = null;
  } else {
    _sessionsData = data.sessions || [];
    _currentSessionId = data.currentSessionId || null;
  }
  if (!_sessionsData.length) {
    memSessionsContent.innerHTML = '<div class="recall-empty">No sessions in database</div>';
    return;
  }
  // Default selection to current session
  if (!_selectedSessionId) _selectedSessionId = _currentSessionId || _sessionsData[_sessionsData.length - 1].session_id;
  await renderSessionCards();
} catch (e) {
  memSessionsContent.innerHTML = `<div class="recall-empty">Failed to load sessions</div>`;
}
}

async function renderSessionCards() {
let html = '';
for (const s of _sessionsData) {
  const roles = s.roles || {};
  const duration = formatDuration(s.first_ts, s.last_ts);
  const isSelected = s.session_id === _selectedSessionId;
  const isCurrent = s.session_id === _currentSessionId;

  if (isSelected) {
    let activityHtml = '';
    try {
      const activity = await AgentClient.getSessionActivity(BASE_URL, AUTH_TOKEN, s.session_id);
      if (activity.daily && activity.daily.length > 0) {
        activityHtml += `<div class="activity-section">
          <div class="activity-section-title">Daily activity</div>
          ${renderBarChart(activity.daily, d => d.date, d => d.count)}
          <div class="chart-label">${activity.daily[0].date} → ${activity.daily[activity.daily.length - 1].date}</div>
        </div>`;
      }
      if (activity.hourly && activity.hourly.length > 0) {
        const hourMap = Object.fromEntries(activity.hourly.map(h => [h.hour, h.count]));
        const full24 = Array.from({ length: 24 }, (_, i) => ({ hour: i, count: hourMap[i] || 0 }));
        activityHtml += `<div class="activity-section">
          <div class="activity-section-title">Hourly distribution (UTC)</div>
          ${renderBarChart(full24, d => `${String(d.hour).padStart(2, '0')}:00`, d => d.count, { barColor: '#8b5cf6' })}
          <div class="chart-label">00:00 → 23:00 UTC</div>
        </div>`;
      }
    } catch {}

    html += `<div class="session-card active" data-sid="${s.session_id}">
      <div class="session-header">
        <span class="session-id">${s.session_id.slice(0, 8)}...${isCurrent ? ' <span style="color:var(--green);font-size:10px;">● live</span>' : ''}</span>
        <span class="session-meta">${s.first_ts ? new Date(s.first_ts).toLocaleDateString() : '?'} — ${s.last_ts ? new Date(s.last_ts).toLocaleDateString() : '?'}</span>
      </div>
      <div class="session-stats">
        <div class="session-stat"><div class="session-stat-value">${s.messages.toLocaleString()}</div><div class="session-stat-label">Messages</div></div>
        <div class="session-stat"><div class="session-stat-value">${duration}</div><div class="session-stat-label">Duration</div></div>
        <div class="session-stat"><div class="session-stat-value">${(roles.user || 0).toLocaleString()}</div><div class="session-stat-label">User</div></div>
        <div class="session-stat"><div class="session-stat-value">${(roles.assistant || 0).toLocaleString()}</div><div class="session-stat-label">Assistant</div></div>
        <div class="session-stat"><div class="session-stat-value">${(roles.tool || 0).toLocaleString()}</div><div class="session-stat-label">Tool</div></div>
      </div>
      ${activityHtml}
    </div>
    `;
  } else {
    html += `<div class="session-card" data-sid="${s.session_id}" style="cursor:pointer;" onclick="selectSession('${s.session_id}')">
      <div class="session-header">
        <span class="session-id">${s.session_id.slice(0, 8)}...${isCurrent ? ' <span style="color:var(--green);font-size:10px;">● live</span>' : ''}</span>
        <span class="session-meta">${s.first_ts ? new Date(s.first_ts).toLocaleDateString() : '?'} — ${s.last_ts ? new Date(s.last_ts).toLocaleDateString() : '?'}</span>
      </div>
      <div class="session-stats">
        <div class="session-stat"><div class="session-stat-value">${s.messages.toLocaleString()}</div><div class="session-stat-label">Messages</div></div>
        <div class="session-stat"><div class="session-stat-value">${duration}</div><div class="session-stat-label">Duration</div></div>
      </div>
    </div>`;
  }
}
memSessionsContent.innerHTML = html;
}

function selectSession(sid) {
_selectedSessionId = sid;
renderSessionCards();
}

function renderAnalytics() {
// Mock data — will be replaced with /sessions/:id/analytics endpoint

// Where conversations happen
const conversations = [
  { name: 'web', count: 8420, color: '#e5b567' },
  { name: 'tui', count: 5230, color: '#8b5cf6' },
  { name: 'telegram', count: 1840, color: '#10b981' },
];

// Who the agent talks to (user IDs from message metadata)
const people = [
  { name: 'tui', count: 8240 },
  { name: 'U07ABCD1234', count: 420 },
];

// What the agent does on its own
const autonomous = [
  { label: 'Heartbeats received', value: 3100 },
  { label: 'Took action', value: 860 },
  { label: 'Stayed silent', value: 2240 },
  { label: 'Sent messages', value: 48 },
  { label: 'Updated notes', value: 124 },
];

// How the agent works — tools as verbs
const actions = [
  { name: 'ran commands', count: 4210 },
  { name: 'read files', count: 3850 },
  { name: 'edited files', count: 2940 },
  { name: 'wrote files', count: 1620 },
  { name: 'searched', count: 1860 },
  { name: 'fetched URLs', count: 340 },
  { name: 'recalled memory', count: 180 },
];

// Conversations the agent chose not to respond to
const silence = [
  { label: 'Slack messages seen', value: 2840 },
  { label: 'Replied', value: 320 },
  { label: 'Ignored (NO_REPLY)', value: 2520 },
  { label: 'Signal ratio', value: '11%' },
];

// Memory activity
const memory = [
  { label: 'Daily notes written', value: 87 },
  { label: 'Knowledge files updated', value: 34 },
  { label: 'Git commits', value: 412 },
  { label: 'Recall searches', value: 180 },
];

const maxConv = Math.max(...conversations.map(c => c.count));
const maxAction = Math.max(...actions.map(a => a.count));

function barRows(items, maxVal, opts = {}) {
  return items.map(item => {
    const pct = (item.count / maxVal * 100).toFixed(0);
    const color = item.color || opts.color || 'var(--ov-accent)';
    return `<div class="analytics-bar-row">
      <span class="label">${item.name}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color};"></div></div>
      <span class="count">${item.count.toLocaleString()}</span>
    </div>`;
  }).join('');
}

function kvRows(items) {
  return items.map(item =>
    `<div class="analytics-row">
      <span class="label">${item.label || item.name}</span>
      <span class="value">${typeof item.value === 'number' ? item.value.toLocaleString() : item.value}</span>
    </div>`
  ).join('');
}

return `<div class="analytics-grid">
  <div class="analytics-panel">
    <div class="analytics-panel-title">Conversations</div>
    ${barRows(conversations, maxConv)}
  </div>
  <div class="analytics-panel">
    <div class="analytics-panel-title">People</div>
    ${kvRows(people)}
  </div>
  <div class="analytics-panel">
    <div class="analytics-panel-title">Autonomous activity</div>
    ${kvRows(autonomous)}
  </div>
  <div class="analytics-panel">
    <div class="analytics-panel-title">Actions</div>
    ${barRows(actions, maxAction)}
  </div>
  <div class="analytics-panel">
    <div class="analytics-panel-title">Listening</div>
    ${kvRows(silence)}
  </div>
  <div class="analytics-panel">
    <div class="analytics-panel-title">Memory</div>
    ${kvRows(memory)}
  </div>
</div>`;
}



$('recall-search-btn').addEventListener('click', doRecallSearch);
$('recall-search-input').addEventListener('keydown', (e) => {
if (e.key === 'Enter') doRecallSearch();
});

document.addEventListener('keydown', (e) => {
if (e.key === 'Escape' && inspectorOverlay.classList.contains('open')) closeInspector();
});

const segDetail = $('segments-detail');
let segDataMap = {};

let segmentFilterMode = 'context';
let contextSegmentIds = new Set();
let expandedSegmentLevels = new Set();
let activeSegmentId = null;

function renderSegments(data) {
const { segments, stats } = data;

const allSegments = segments || [];
const filteredSegments = segmentFilterMode === 'context'
  ? allSegments.filter(s => contextSegmentIds.has(s.id))
  : allSegments;

const statSegments = filteredSegments;
const totalTokens = statSegments.reduce((s, seg) => s + (seg.token_count || 0), 0);
const totalSummaryTokens = statSegments.reduce((s, seg) => s + (seg.summary_token_count || Math.ceil((seg.summary || '').length / 3.3)), 0);
const ratio = totalSummaryTokens > 0 ? Math.round(totalTokens / totalSummaryTokens) : 0;
const levelCount = new Set(statSegments.map(s => s.level || 0)).size;
const messageSpan = statSegments.length > 0
  ? (Math.max(...statSegments.map(s => s.msg_end || 0)) - Math.min(...statSegments.map(s => s.msg_start || 0)) + 1)
  : 0;
const avgSummary = statSegments.length > 0 ? Math.round(totalSummaryTokens / statSegments.length) : 0;
const label = segmentFilterMode === 'context' ? 'context' : 'all';
inspectorStats.textContent = statSegments.length > 0
  ? `${statSegments.length} ${label} segments · ${levelCount} level${levelCount > 1 ? 's' : ''}`
  : `${label}: 0 segments`;

if (!filteredSegments || filteredSegments.length === 0) {
  segTimeline.innerHTML = '<div style="color:var(--text-muted);padding:20px;">No segments yet. Use Start or Rebuild to index.</div>';
  return;
}

let html = '';
html += `<div class="segments-overview">`;
html += `<div class="segments-stat-card"><div class="k">Messages</div><div class="v">${messageSpan.toLocaleString()}</div></div>`;
html += `<div class="segments-stat-card"><div class="k">Source tokens</div><div class="v">${totalTokens.toLocaleString()}</div></div>`;
html += `<div class="segments-stat-card"><div class="k">Summary tokens</div><div class="v">${totalSummaryTokens.toLocaleString()}</div></div>`;
html += `<div class="segments-stat-card"><div class="k">Compression</div><div class="v">${ratio}:1</div></div>`;
html += `<div class="segments-stat-card"><div class="k">Segments</div><div class="v">${statSegments.length.toLocaleString()}</div></div>`;
html += `<div class="segments-stat-card"><div class="k">Avg summary / seg</div><div class="v">${avgSummary.toLocaleString()} tok</div></div>`;
html += `</div>`;

// Group by level
const levels = {};
const children = {};
let maxMsgEnd = 0;
for (const seg of filteredSegments) {
  const lvl = seg.level || 0;
  if (seg.parent_id) {
    if (!children[lvl]) children[lvl] = [];
    children[lvl].push(seg);
  } else {
    if (!levels[lvl]) levels[lvl] = [];
    levels[lvl].push(seg);
  }
  if (seg.msg_end > maxMsgEnd) maxMsgEnd = seg.msg_end;
}

segDataMap = {};
const allLevelKeys = new Set([...Object.keys(levels), ...Object.keys(children)]);
const sortedLevels = [...allLevelKeys].map(Number).sort();

const MIN_BLOCK_PX = 40;
const MAX_BLOCK_PX = 200;

for (const lvl of sortedLevels) {
  const segs = levels[lvl] || [];
  const childSegs = children[lvl] || [];
  const allSegs = [...childSegs, ...segs];
  if (allSegs.length === 0) continue;
  // Scale widths within this level: smallest → MIN, largest → MAX
  const spans = allSegs.map(s => s.msg_end - s.msg_start);
  const minSpan = Math.min(...spans);
  const maxSpan = Math.max(...spans);
  const spanRange = maxSpan - minSpan || 1;

  const childCount = childSegs.length;
  const totalCount = childCount + segs.length;

  html += `<div class="segments-level">`;
  html += `<div class="segments-level-label">Level ${lvl} · ${totalCount} segments${childCount > 0 ? ` (${childCount} rolled up)` : ''}</div>`;
  html += `<div class="segments-row">`;

  // Collapsed children block — click to expand
  if (childCount > 0) {
    const childSpan = childSegs.reduce((s, seg) => s + (seg.msg_end - seg.msg_start), 0);
    html += `<div class="seg-collapsed" data-level="${lvl}"><div>${childCount} segments</div><div style="opacity:0.6">${childSpan.toLocaleString()} messages</div></div>`;
    html += `<div class="seg-children-row" data-level="${lvl}" style="display:none">`;
    for (const seg of childSegs) {
      segDataMap[seg.id] = seg;
      const span = seg.msg_end - seg.msg_start;
      const t = (span - minSpan) / spanRange;
      const widthPx = Math.round(MIN_BLOCK_PX + t * (MAX_BLOCK_PX - MIN_BLOCK_PX));
      const color = segColor(seg.token_count || 0, span);
      const height = Math.max(24, Math.min(48, Math.round(Math.sqrt(seg.token_count || 0) / 2)));
      const label = `${span}`;
      html += `<div class="seg-block seg-child" style="width:${widthPx}px;height:${height}px;background:${color};"
        data-seg-id="${seg.id}"
      >${label}</div>`;
    }
    html += `</div>`;
  }

  // Orphan blocks
  for (const seg of segs) {
    segDataMap[seg.id] = seg;
    const span = seg.msg_end - seg.msg_start;
    const t = (span - minSpan) / spanRange;
    const widthPx = Math.round(MIN_BLOCK_PX + t * (MAX_BLOCK_PX - MIN_BLOCK_PX));
    const color = segColor(seg.token_count || 0, span);
    const height = Math.max(24, Math.min(64, Math.round(Math.sqrt(seg.token_count || 0) / 2)));
    const cls = seg.summarized ? '' : ' unsummarized';
    const label = `${span}`;

    html += `<div class="seg-block${cls}" style="width:${widthPx}px;height:${height}px;background:${color};"
      data-seg-id="${seg.id}"
    >${label}</div>`;
  }

  html += '</div></div>';
}

segTimeline.innerHTML = html;

// Toggle collapsed children
segTimeline.querySelectorAll('.seg-collapsed').forEach(el => {
  el.addEventListener('click', () => {
    const lvl = el.dataset.level;
    const row = segTimeline.querySelector(`.seg-children-row[data-level="${lvl}"]`);
    if (!row) return;
    const open = row.style.display !== 'none';
    row.style.display = open ? 'none' : 'flex';
    el.textContent = el.textContent.replace(/^[▸▾]/, open ? '▸' : '▾');
    el.classList.toggle('open', !open);
    if (open) expandedSegmentLevels.delete(String(lvl));
    else expandedSegmentLevels.add(String(lvl));
  });
});

for (const lvl of expandedSegmentLevels) {
  const toggle = segTimeline.querySelector(`.seg-collapsed[data-level="${lvl}"]`);
  const row = segTimeline.querySelector(`.seg-children-row[data-level="${lvl}"]`);
  if (!toggle || !row) continue;
  row.style.display = 'flex';
  toggle.textContent = toggle.textContent.replace(/^[▸▾]/, '▾');
  toggle.classList.add('open');
}

// Hover to show detail panel
segTimeline.querySelectorAll('.seg-block').forEach(el => {
  el.addEventListener('mouseenter', () => showSegDetail(el));
  el.addEventListener('click', () => showSegDetail(el));
});

if (activeSegmentId != null) {
  const active = segTimeline.querySelector(`.seg-block[data-seg-id="${activeSegmentId}"]`);
  if (active) showSegDetail(active);
}
}

async function resummarizeSegment(segId) {
if (!BASE_URL) return;
const btn = document.getElementById(`seg-resummarize-${segId}`);
if (btn) {
  btn.disabled = true;
  btn.textContent = 'Resummarizing...';
}
try {
  const res = await fetch(`${BASE_URL}/segments/${segId}/resummarize`, {
    method: 'POST',
    headers: AgentClient._headers(AUTH_TOKEN),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'resummarize failed');
  await fetchAndRenderSegments();
  const active = segTimeline.querySelector(`.seg-block[data-seg-id="${segId}"]`);
  if (active) showSegDetail(active);
} catch (e) {
  console.error('resummarize failed:', e);
  if (btn) btn.textContent = 'Failed';
  setTimeout(() => {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Resummarize';
    }
  }, 1500);
  return;
}
}

function showSegDetail(el) {
segTimeline.querySelectorAll('.seg-block.active').forEach(b => b.classList.remove('active'));
el.classList.add('active');
activeSegmentId = Number(el.dataset.segId);

const seg = segDataMap[el.dataset.segId];
if (!seg) return;

const span = seg.msg_end - seg.msg_start;
const tokens = (seg.token_count || 0).toLocaleString();
const summaryTokens = seg.summary_token_count || Math.ceil((seg.summary || '').length / 3.3);
const compression = summaryTokens > 0 ? Math.round(seg.token_count / summaryTokens) : '?';
const title = `Msgs ${seg.msg_start}–${seg.msg_end}`;
const subtitle = `${span} messages${seg.level != null ? ` · L${seg.level}` : ''}${seg.parent_id ? ` · parent ${seg.parent_id}` : ''}`;
const timeRange = `${seg.start_time ? new Date(seg.start_time).toLocaleString() : '—'}${seg.start_time && seg.end_time ? ' – ' : ''}${seg.end_time ? new Date(seg.end_time).toLocaleString() : ''}`;

segDetail.classList.remove('empty');
segDetail.innerHTML = `
  <div class="seg-detail-heading">
    <div class="seg-detail-title">${title}</div>
    <div class="seg-detail-subtitle">${subtitle}</div>
  </div>
  <div class="seg-detail-time">${timeRange}</div>
  <div class="seg-detail-meta">
    <div class="seg-detail-meta-card">
      <div class="k">Compression</div>
      <div class="v">${tokens} → ${summaryTokens} summary tokens (${compression}:1)</div>
    </div>
  </div>
  ${!seg.summarized ? '<div style="color:var(--orange);font-size:12px;font-family:var(--font-mono);margin-bottom:10px;">not yet summarized</div>' : ''}
  <div class="seg-detail-actions">
    <button id="seg-resummarize-${seg.id}" class="modal-btn">Resummarize</button>
  </div>
  <div class="seg-detail-summary">${seg.summary ? renderMarkdown(seg.summary) : '<span style="color:var(--text-muted);font-style:italic;">no summary</span>'}</div>
`;

const btn = document.getElementById(`seg-resummarize-${seg.id}`);
if (btn) btn.addEventListener('click', () => resummarizeSegment(seg.id));
}

function escHtml(s) {
const d = document.createElement('div');
d.textContent = s;
return d.innerHTML;
}

