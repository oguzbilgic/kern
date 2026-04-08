// ==========================================================================
// UI
// ==========================================================================

const $ = (id) => document.getElementById(id);
const messagesEl = $('messages');
const inputEl = $('input');
const sendBtn = $('send');
const statusDot = $('status-dot');
const agentNameEl = $('agent-name');
const infoPanel = $('header-info');

// --- Attachment management ---
const fileInput = $('file-input');
const attachBtn = $('attach-btn');
const attachPreview = $('attachment-preview');
const dropOverlay = $('drop-overlay');
let pendingAttachments = []; // { file, type, mimeType, dataUrl, base64, filename, size }

function fileToAttachment(file) {
return new Promise((resolve) => {
  const reader = new FileReader();
  reader.onload = () => {
    const base64 = reader.result.split(',')[1];
    const type = file.type.startsWith('image/') ? 'image'
      : file.type.startsWith('video/') ? 'video'
      : file.type.startsWith('audio/') ? 'audio'
      : 'document';
    resolve({
      file,
      type,
      mimeType: file.type || 'application/octet-stream',
      filename: file.name,
      size: file.size,
      dataUrl: reader.result,
      base64,
    });
  };
  reader.readAsDataURL(file);
});
}

async function addFiles(files) {
for (const file of files) {
  if (file.size > 20 * 1024 * 1024) {
    addMessage('error', `File too large: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB, max 20MB)`);
    continue;
  }
  const att = await fileToAttachment(file);
  pendingAttachments.push(att);
}
renderAttachmentPreviews();
updateSendState();
}

function removeAttachment(idx) {
pendingAttachments.splice(idx, 1);
renderAttachmentPreviews();
updateSendState();
}

function renderAttachmentPreviews() {
attachPreview.innerHTML = '';
if (pendingAttachments.length === 0) {
  attachPreview.classList.remove('has-items');
  return;
}
attachPreview.classList.add('has-items');
pendingAttachments.forEach((att, i) => {
  const thumb = document.createElement('div');
  thumb.className = 'attachment-thumb';
  if (att.type === 'image') {
    thumb.innerHTML = `<img src="${att.dataUrl}" alt="${att.filename}" /><button class="remove-btn" data-idx="${i}">\u00d7</button>`;
  } else {
    const icon = att.type === 'video' ? '\ud83c\udfac' : att.type === 'audio' ? '\ud83c\udfb5' : '\ud83d\udcc4';
    thumb.innerHTML = `<div class="file-label">${icon} ${att.filename}</div><button class="remove-btn" data-idx="${i}">\u00d7</button>`;
  }
  thumb.querySelector('.remove-btn').addEventListener('click', () => removeAttachment(i));
  attachPreview.appendChild(thumb);
});
}

function updateSendState() {
sendBtn.disabled = !inputEl.value.trim() && pendingAttachments.length === 0;
}

// Paperclip button
attachBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
if (fileInput.files.length > 0) addFiles(Array.from(fileInput.files));
fileInput.value = '';
});

// Paste handler — images from clipboard
inputEl.addEventListener('paste', (e) => {
const items = e.clipboardData?.items;
if (!items) return;
const files = [];
for (const item of items) {
  if (item.kind === 'file') {
    const file = item.getAsFile();
    if (file) files.push(file);
  }
}
if (files.length > 0) {
  e.preventDefault();
  addFiles(files);
}
});

// Drag and drop
let dragCounter = 0;
document.addEventListener('dragenter', (e) => {
e.preventDefault();
dragCounter++;
if (dragCounter === 1) dropOverlay.classList.add('visible');
});
document.addEventListener('dragleave', (e) => {
e.preventDefault();
dragCounter--;
if (dragCounter <= 0) { dragCounter = 0; dropOverlay.classList.remove('visible'); }
});
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
e.preventDefault();
dragCounter = 0;
dropOverlay.classList.remove('visible');
if (e.dataTransfer?.files.length > 0) addFiles(Array.from(e.dataTransfer.files));
});

// --- Pinned header stats ---
const headerStatsEl = $('header-stats');

function getPinnedFields() {
try { return JSON.parse(localStorage.getItem('kern_pinned_stats') || '[]'); } catch { return []; }
}
function setPinnedFields(fields) {
localStorage.setItem('kern_pinned_stats', JSON.stringify(fields));
}
function togglePin(field) {
const pinned = getPinnedFields();
const idx = pinned.indexOf(field);
if (idx >= 0) pinned.splice(idx, 1); else pinned.push(field);
setPinnedFields(pinned);
return pinned;
}

let lastStatusData = null;

function buildStatusRows(status) {
const esc = (s) => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const cb = status.contextBreakdown;
let contextVal;
if (cb) {
  const total = Math.round(((cb.systemPromptTokens || 0) + cb.messageTokens + cb.summaryTokens) / 1000);
  contextVal = `~${total}k tokens (${cb.messageCount} msgs)`;
} else {
  contextVal = status.context || '';
}
const rows = [
  { key: 'version', label: 'version', value: `v${esc(status.version) || '?'}` },
  { key: 'model', label: 'model', value: `${esc(status.model)}` },
  { key: 'uptime', label: 'uptime', value: esc(status.uptime) },
  { key: 'session', label: 'session', value: esc(status.session) },
  { key: 'context', label: 'context', value: contextVal },
  { key: 'apiUsage', label: 'api usage', value: esc(status.apiUsage) },
];
if (status.cacheUsage) rows.push({ key: 'cache', label: 'cache', value: esc(status.cacheUsage) });
if (status.telegram) rows.push({ key: 'telegram', label: 'telegram', value: esc(status.telegram) });
if (status.slack) rows.push({ key: 'slack', label: 'slack', value: esc(status.slack) });
if (status.recall) rows.push({ key: 'recall', label: 'recall', value: esc(status.recall) });
if (status.hub) {
  const hubMatch = status.hub.match(/^(wss?:\/\/[^\s]+)\s*\((.+)\)$/);
  if (hubMatch) {
    const hubPort = hubMatch[1].match(/:(\d+)/)?.[1] || '4000';
    const hubDash = `${location.protocol}//${location.hostname}:${hubPort}`;
    rows.push({ key: 'hub', label: 'hub', value: `<a href="${esc(hubDash)}" target="_blank" style="color:var(--accent);text-decoration:none">${esc(hubDash)}</a> (${esc(hubMatch[2])})` });
  } else {
    rows.push({ key: 'hub', label: 'hub', value: esc(status.hub) });
  }
}
rows.push({ key: 'queue', label: 'queue', value: esc(status.queue) });
rows.push({ key: 'tools', label: 'tools', value: esc(status.toolScope) });
return rows;
}

function renderHeaderStats() {
if (!lastStatusData) { headerStatsEl.innerHTML = ''; return; }
const pinned = getPinnedFields();
const rows = buildStatusRows(lastStatusData);
const parts = rows.filter(r => pinned.includes(r.key)).map(r => r.value);
headerStatsEl.innerHTML = parts.length ? parts.join('<span class="stat-sep">·</span>') : '';
}

async function fetchAndCacheStatus() {
if (!BASE_URL) return null;
try {
  const res = await fetch(`${BASE_URL}/status`, { headers: AgentClient._headers(AUTH_TOKEN) });
  if (!res.ok) return null;
  lastStatusData = await res.json();
  const active = getActiveAgent();
  if (active) { getAgentConn(active).statusData = lastStatusData; }
  renderHeaderStats();
  renderSwitcher();
  return lastStatusData;
} catch { return null; }
}

// Toggle agent info panel
async function toggleInfoPanel() {
if (infoPanel.classList.contains('open')) {
  infoPanel.classList.remove('open');
  return;
}
if (!BASE_URL) return;
const status = await fetchAndCacheStatus();
if (!status) return;
const pinned = getPinnedFields();
const rows = buildStatusRows(status);
infoPanel.innerHTML = `
  <div class="info-grid">
    ${rows.map(r => `<div class="info-row" data-pin="${r.key}" style="cursor:pointer"><span class="info-label">${r.label}</span><span class="info-value">${r.value}</span><span class="pin-btn ${pinned.includes(r.key) ? 'pinned' : ''}">${pinned.includes(r.key) ? '●' : '○'}</span></div>`).join('')}
  </div>
`;
infoPanel.querySelectorAll('.info-row[data-pin]').forEach(row => {
  row.addEventListener('click', (e) => {
    e.stopPropagation();
    const key = row.dataset.pin;
    const newPinned = togglePin(key);
    const isPinned = newPinned.includes(key);
    row.querySelector('.pin-btn').classList.toggle('pinned', isPinned);
    row.querySelector('.pin-btn').textContent = isPinned ? '●' : '○';
    renderHeaderStats();
    renderSwitcher();
  });
});
infoPanel.classList.add('open');
}
agentNameEl.addEventListener('click', toggleInfoPanel);
headerStatsEl.addEventListener('click', toggleInfoPanel);

