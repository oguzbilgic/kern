// ==========================================================================
// Agent Switcher
// ==========================================================================

// Servers — stored in localStorage as [{url, token}]
function getSavedServers() {
try { return JSON.parse(localStorage.getItem('kern_servers') || '[]'); } catch { return []; }
}
function saveServers(servers) {
localStorage.setItem('kern_servers', JSON.stringify(servers));
}
// Get token for a server URL (local or remote)
function getServerToken(serverUrl) {
if (serverUrl === location.origin) {
  return localStorage.getItem('kern_web_token') || null;
}
const servers = getSavedServers();
const entry = servers.find(s => s.url === serverUrl);
return entry ? entry.token : null;
}
function setLocalToken(token) {
localStorage.setItem('kern_web_token', token);
}
function getActiveAgent() {
return sessionStorage.getItem('kern_active_agent') || null;
}
function setActiveAgent(name) {
sessionStorage.setItem('kern_active_agent', name);
updateTitle(!!$('thinking'));
}

// All discovered agents grouped by server — fetched fresh each time
let allAgents = [];
let allHubs = [];

// --- Multi-agent connection manager ---
const IDLE_TIMEOUT = 15 * 60 * 1000; // 15 minutes
const agentConns = {}; // { agentName: { sse, idleTimer, unread, thinking } }

function getAgentConn(name) {
if (!agentConns[name]) agentConns[name] = { sse: null, idleTimer: null, unread: 0, thinking: false, _inText: false, statusData: null };
return agentConns[name];
}

function setAgentThinking(name, value) {
const conn = getAgentConn(name);
if (conn.thinking !== value) {
  conn.thinking = value;
  renderSwitcher();
}
}

function connectAgent(agent) {
const conn = getAgentConn(agent.name);
// Already connected
if (conn.sse) return;
const token = getServerToken(agent.server || location.origin);
const url = token ? `${agent.url}/events?token=${encodeURIComponent(token)}` : `${agent.url}/events`;
const es = new EventSource(url);
conn.sse = es;
es.onmessage = (e) => {
  try {
    const ev = JSON.parse(e.data);
    if (ev.type === 'connection') return;
    if (agent.name === getActiveAgent()) return;
    // Track thinking state
    if (ev.type === 'thinking') {
      setAgentThinking(agent.name, true);
    }
    // Count each text step as unread
    if (ev.type === 'text-delta' && !conn._inText) {
      conn._inText = true;
      conn.unread++;
      renderSwitcher();
    }
    // Reset text tracking on tool calls or finish
    if (ev.type === 'tool-call' || ev.type === 'tool-result') {
      conn._inText = false;
    }
    // Turn finished
    if (ev.type === 'finish') {
      conn._inText = false;
      setAgentThinking(agent.name, false);
    }
  } catch { /* ignore parse errors */ }
};
es.onerror = () => {
  // Don't kill the connection — EventSource auto-reconnects on transient errors.
  // Only clean up if the connection is fully dead (readyState === CLOSED).
  if (es.readyState === EventSource.CLOSED) {
    conn.sse = null;
    renderSwitcher();
  }
};
renderSwitcher();
}

function disconnectAgent(name) {
const conn = getAgentConn(name);
if (conn.sse) { conn.sse.close(); conn.sse = null; }
if (conn.idleTimer) { clearTimeout(conn.idleTimer); conn.idleTimer = null; }
renderSwitcher();
}

function startIdleTimer(name) {
const conn = getAgentConn(name);
if (conn.idleTimer) clearTimeout(conn.idleTimer);
conn.idleTimer = setTimeout(() => {
  conn.idleTimer = null;
  disconnectAgent(name);
}, IDLE_TIMEOUT);
}

function clearIdleTimer(name) {
const conn = getAgentConn(name);
if (conn.idleTimer) { clearTimeout(conn.idleTimer); conn.idleTimer = null; }
}

async function connectAllBackground() {
const activeName = getActiveAgent();
const agents = getAllAgents().filter(a => a.running && a.url && a.name !== activeName);
for (const agent of agents) {
  connectAgent(agent);
  startIdleTimer(agent.name);
}
// Check busy state for all background agents
await Promise.all(agents.map(async (agent) => {
  try {
    const token = getServerToken(agent.server || location.origin);
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
    const res = await fetch(`${agent.url}/status`, { headers });
    if (res.ok) {
      const data = await res.json();
      setAgentThinking(agent.name, typeof data.queue === 'string' && data.queue.startsWith('busy'));
    }
  } catch { /* ignore fetch errors */ }
}));
}

function getAgentState(agent) {
const activeName = getActiveAgent();
if (agent.name === activeName) return 'active';
if (!agent.running) return 'offline';
const conn = getAgentConn(agent.name);
if (conn.sse) return 'connected';
return 'online';
}

let BASE_URL = null;
let AUTH_TOKEN = null;

// Avatar color from name hash
const AVATAR_COLORS = ['#e06c75','#e5c07b','#98c379','#56b6c2','#61afef','#c678dd','#be5046','#d19a66'];
function avatarColor(name) {
let hash = 0;
for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// Render switcher panel — grouped by server
function renderSwitcher() {
const list = $('switcher-list');
const agents = getAllAgents();
const activeName = getActiveAgent();
list.innerHTML = '';
if (agents.length === 0) {
  list.innerHTML = '<div style="padding:12px;color:var(--text-muted);font-size:12px;">No agents found.</div>';
} else {
  // Group by server
  const groups = new Map();
  for (const agent of agents) {
    const key = agent.server || location.origin;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(agent);
  }
  const remoteServers = getSavedServers();
  for (const [serverUrl, serverAgents] of groups) {
    const isLocal = serverUrl === location.origin;
    const isRemote = remoteServers.some(s => s.url === serverUrl);
    // Server header for remote servers
    if (!isLocal) {
      const header = document.createElement('div');
      header.className = 'switcher-server-header';
      let label;
      try { label = new URL(serverUrl).hostname; } catch { label = serverUrl; }
      header.innerHTML = `<span>${escapeHtml(label)}</span>`;
      if (isRemote) {
        const removeBtn = document.createElement('button');
        removeBtn.className = 'switcher-item-remove';
        removeBtn.title = 'Remove server';
        removeBtn.innerHTML = '&times;';
        removeBtn.style.display = 'inline';
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          saveServers(remoteServers.filter(s => s.url !== serverUrl));
          allAgents = allAgents.filter(a => a.server !== serverUrl);
          renderSwitcher();
        });
        header.appendChild(removeBtn);
      }
      list.appendChild(header);
    }
    for (const agent of serverAgents) {
      const item = document.createElement('div');
      const state = getAgentState(agent);
      const classes = ['switcher-item'];
      if (state === 'active') classes.push('active');
      if (state === 'offline') classes.push('offline');
      item.className = classes.join(' ');
      const color = avatarColor(agent.name);
      const initial = agent.name.charAt(0).toUpperCase();
      const conn = getAgentConn(agent.name);
      const dotClasses = [state];
      if (agent.hubConnected) dotClasses.push('hub');
      if (conn.thinking) dotClasses.push('thinking');
      if (conn.unread > 0 && state !== 'active') dotClasses.push('has-unread');
      const dotContent = (conn.unread > 0 && state !== 'active')
        ? (conn.unread > 99 ? '99+' : conn.unread) : '';
      const pinned = getPinnedFields();
      const agentConn = getAgentConn(agent.name);
      let statLine = '';
      if (pinned.length > 0 && agentConn.statusData) {
        const sRows = buildStatusRows(agentConn.statusData);
        const first = sRows.find(r => pinned.includes(r.key));
        if (first) statLine = `<div class="switcher-item-status">${first.value}</div>`;
      }
      item.innerHTML = `
        <div class="switcher-item-avatar" style="background:${color}">
          ${initial}
          <span class="online-dot ${dotClasses.join(' ')}">${dotContent}</span>
        </div>
        <div class="switcher-item-info">
          <div class="switcher-item-name">${agent.name}</div>
          ${statLine}
        </div>
      `;
      if (agent.running && agent.url) {
        item.addEventListener('click', () => switchToAgent(agent));
      }
      list.appendChild(item);
    }

    // Hub item for this server
    const serverHub = allHubs.find(h => h.server === serverUrl);
    if (serverHub) {
      const hubItem = document.createElement('div');
      hubItem.className = 'switcher-hub-item';
      if (serverHub.running) {
        const onlineCount = serverHub.agents.filter(a => a.online).length;
        const totalCount = serverHub.agents.length;
        hubItem.innerHTML = `
          <div class="hub-icon">◆</div>
          <div class="hub-info">
            <div class="hub-name">Hub</div>
            <div class="hub-meta">${onlineCount}/${totalCount} agents online</div>
          </div>
        `;
        hubItem.addEventListener('click', () => showHubModal(serverHub, serverUrl));
      } else {
        hubItem.style.cursor = 'default';
        hubItem.innerHTML = `
          <div class="hub-icon" style="background:rgba(255,255,255,0.06);color:var(--text-muted)">◆</div>
          <div class="hub-info">
            <div class="hub-name">Hub</div>
            <div class="hub-meta">Offline</div>
          </div>
        `;
      }
      list.appendChild(hubItem);
    }
  }
}
// Add server row
const addItem = document.createElement('div');
addItem.className = 'switcher-add-inline';
addItem.innerHTML = '<span>+</span> Add server';
addItem.addEventListener('click', () => {
  $('add-modal').classList.add('open');
  $('add-url').focus();
});
list.appendChild(addItem);

// Update hub footer link
discoverHub();
}

async function showHubModal(hub, serverUrl) {
const modal = $('hub-modal');
const token = getServerToken(serverUrl);
const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

let stats = null;
try {
  const res = await fetch(`${serverUrl}/api/hub/stats`, { headers });
  if (res.ok) stats = await res.json();
} catch {}

let hubUrl = serverUrl;
try {
  const hubRes = await fetch(`${serverUrl}/api/hub`, { headers });
  if (hubRes.ok) {
    const hubData = await hubRes.json();
    if (hubData.port) {
      const u = new URL(serverUrl);
      hubUrl = `${u.protocol}//${u.hostname}:${hubData.port}`;
    }
  }
} catch {}
$('hub-modal-url').textContent = hubUrl;

const statsEl = $('hub-modal-stats');
if (stats) {
  const h = Math.floor(stats.uptime / 3600);
  const m = Math.floor((stats.uptime % 3600) / 60);
  const uptimeStr = h > 0 ? `${h}h ${m}m` : `${m}m`;
  statsEl.innerHTML = `
    <div class="hub-stat"><div class="hub-stat-value">${stats.agents.online}/${stats.agents.registered}</div><div class="hub-stat-label">Agents online</div></div>
    <div class="hub-stat"><div class="hub-stat-value">${stats.messages}</div><div class="hub-stat-label">Messages</div></div>
    <div class="hub-stat"><div class="hub-stat-value">${uptimeStr}</div><div class="hub-stat-label">Uptime</div></div>
  `;
} else {
  statsEl.innerHTML = '';
}

const agentsEl = $('hub-modal-agents');
const agents = hub.agents || [];
agentsEl.innerHTML = `
  <div class="hub-modal-agents-title">Connected agents</div>
  ${agents
    .sort((a, b) => (b.online ? 1 : 0) - (a.online ? 1 : 0) || a.name.localeCompare(b.name))
    .map(a => `<div class="hub-agent-row${a.online ? '' : ' offline'}"><span class="hub-agent-dot"></span><span>${escapeHtml(a.name)}</span>${a.id ? `<span class="hub-agent-id">${escapeHtml(a.id)}</span>` : ''}</div>`)
    .join('')}
  ${agents.length === 0 ? '<div style="font-size:12px;color:var(--text-muted)">No agents connected</div>' : ''}
`;

modal.classList.add('open');
}

$('hub-modal-close').addEventListener('click', () => $('hub-modal').classList.remove('open'));
$('hub-modal').addEventListener('click', (e) => { if (e.target === $('hub-modal')) $('hub-modal').classList.remove('open'); });

async function discoverHub() {
try {
  const hubLink = $('hub-link');
  if (allHubs.length > 0 && allHubs[0].running) {
    const serverUrl = allHubs[0].server || location.origin;
    const token = getServerToken(serverUrl);
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
    let hubUrl = serverUrl;
    try {
      const hubRes = await fetch(`${serverUrl}/api/hub`, { headers });
      if (hubRes.ok) {
        const hubData = await hubRes.json();
        if (hubData.port) {
          const u = new URL(serverUrl);
          hubUrl = `${u.protocol}//${u.hostname}:${hubData.port}`;
        }
      }
    } catch {}
    hubLink.href = hubUrl;
    hubLink.style.display = 'flex';
    hubLink.title = `Hub at ${hubUrl}`;
  } else {
    hubLink.style.display = 'none';
  }
} catch {}
}

function switchToAgent(agent) {
const prevName = getActiveAgent();

// Move previous agent to background: open background SSE + start idle timer
if (prevName && prevName !== agent.name) {
  const prevAgentObj = allAgents.find(a => a.name === prevName && a.running);
  if (prevAgentObj) {
    connectAgent(prevAgentObj);
  }
  startIdleTimer(prevName);
}

setActiveAgent(agent.name);
BASE_URL = agent.url;
AUTH_TOKEN = getServerToken(agent.server || location.origin);
authFailed = false;
intentionalClose = true;
if (connection) { connection.close(); connection = null; }
flushStreaming();
hideThinking();
messagesEl.innerHTML = '';
inputEl.disabled = false;
sendBtn.disabled = false;
inputEl.value = '';
infoPanel.classList.remove('open');

// Clear unread, thinking, and idle timer for new active agent
const conn = getAgentConn(agent.name);
conn.unread = 0;
conn._inText = false;
clearIdleTimer(agent.name);

// Close background SSE for this agent (init() will open the main one)
if (conn.sse) { conn.sse.close(); conn.sse = null; }

// On narrow windows, clamp to mini sidebar instead of collapsing fully.
if (window.innerWidth <= 768) {
  sidebar.classList.remove('collapsed');
  sidebar.classList.add('mini');
}
renderSwitcher();
init();
inputEl.focus();
}

function toggleSidebar() {
const sidebar = $('sidebar');
const isCollapsed = sidebar.classList.contains('collapsed');
if (isCollapsed) {
  // Restore previous non-collapsed state
  sidebar.classList.remove('collapsed');
  const prev = localStorage.getItem('kern_sidebar_prev') || 'full';
  if (prev === 'mini') sidebar.classList.add('mini');
  else sidebar.classList.remove('mini');
  localStorage.setItem('kern_sidebar_state', prev);
} else {
  // Save current state and collapse
  const current = sidebar.classList.contains('mini') ? 'mini' : 'full';
  localStorage.setItem('kern_sidebar_prev', current);
  sidebar.classList.remove('mini');
  sidebar.classList.add('collapsed');
  localStorage.setItem('kern_sidebar_state', 'collapsed');
}
}

// Sidebar drag-to-resize with snap points
(function() {
const handle = $('sidebar-resize');
const sidebar = $('sidebar');
if (!handle) return;
let dragging = false;

handle.addEventListener('mousedown', (e) => {
  e.preventDefault();
  dragging = true;
  handle.classList.add('dragging');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
});
document.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  const x = e.clientX;
  sidebar.classList.remove('mini', 'collapsed');
  // Snap: <35px = collapsed, 35-120 = mini(62px), >120 = full(200px)
  if (x < 35) {
    sidebar.classList.add('collapsed');
    localStorage.setItem('kern_sidebar_state', 'collapsed');
  } else if (x < 120) {
    sidebar.classList.add('mini');
    localStorage.setItem('kern_sidebar_state', 'mini');
  } else {
    localStorage.setItem('kern_sidebar_state', 'full');
  }
});
document.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging = false;
  handle.classList.remove('dragging');
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
});
// Double-click toggles between full and mini
handle.addEventListener('dblclick', () => {
  sidebar.classList.remove('collapsed');
  const isMini = sidebar.classList.contains('mini');
  sidebar.classList.toggle('mini', !isMini);
  localStorage.setItem('kern_sidebar_state', isMini ? 'full' : 'mini');
});
})();
function openSidebar() {
const sidebar = $('sidebar');
sidebar.classList.remove('collapsed');
const prev = localStorage.getItem('kern_sidebar_prev') || 'full';
if (prev === 'mini') sidebar.classList.add('mini');
localStorage.setItem('kern_sidebar_state', prev);
}
function closeSidebar() {
const sidebar = $('sidebar');
const current = sidebar.classList.contains('mini') ? 'mini' : 'full';
localStorage.setItem('kern_sidebar_prev', current);
sidebar.classList.remove('mini');
sidebar.classList.add('collapsed');
localStorage.setItem('kern_sidebar_state', 'collapsed');
}

// Restore sidebar state on load
{
const sidebarState = localStorage.getItem('kern_sidebar_state') || 'full';
if (sidebarState === 'mini') $('sidebar').classList.add('mini');
else if (sidebarState === 'collapsed') $('sidebar').classList.add('collapsed');
// Small windows: force mini if full
if (window.innerWidth <= 768 && sidebarState === 'full') {
  $('sidebar').classList.add('mini');
  localStorage.setItem('kern_sidebar_state', 'mini');
}
}

// Fetch agents from a server URL, returns { agents, status }
async function fetchServerAgents(serverUrl) {
try {
  const token = getServerToken(serverUrl);
  const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
  const res = await fetch(`${serverUrl}/api/agents`, { headers });
  if (res.status === 401) return { agents: [], hub: null, status: 'unauthorized' };
  if (!res.ok) return { agents: [], hub: null, status: 'error' };
  const data = await res.json();
  if (!Array.isArray(data)) return { agents: [], hub: null, status: 'ok' };

  // Also fetch hub info
  let hub = null;
  try {
    const hubRes = await fetch(`${serverUrl}/api/hub`, { headers });
    if (hubRes.ok) {
      const hubData = await hubRes.json();
      if (hubData.configured) {
        hub = { running: hubData.running, port: hubData.port, agents: [], server: serverUrl };
        if (hubData.running) {
          const hubAgentsRes = await fetch(`${serverUrl}/api/hub/agents`, { headers });
          if (hubAgentsRes.ok) hub.agents = await hubAgentsRes.json();
        }
      }
    }
  } catch {}

  // Fetch hub connection status for each running agent
  const agentList = await Promise.all(data.map(async (a) => {
    const agent = {
      name: a.name,
      url: a.running ? `${serverUrl}/api/agents/${a.name}` : null,
      running: a.running,
      server: serverUrl,
      hubConnected: false,
    };
    if (a.running) {
      try {
        const statusRes = await fetch(`${serverUrl}/api/agents/${a.name}/status`, { headers });
        if (statusRes.ok) {
          const status = await statusRes.json();
          if (status.hub && status.hub.includes('connected')) agent.hubConnected = true;
        }
      } catch {}
    }
    return agent;
  }));

  return { status: 'ok', hub, agents: agentList };
} catch { return { agents: [], hub: null, status: 'error' }; }
}

// Discover agents from local server + all saved remote servers
// Returns 'ok', 'unauthorized' (local server needs token), or 'error'
async function discoverAllAgents() {
const localUrl = location.origin;
// Filter out remote servers that match the local URL to prevent duplicates
const remoteUrls = getSavedServers().map(s => s.url).filter(u => u !== localUrl);
const allUrls = [localUrl, ...remoteUrls];
const results = await Promise.all(allUrls.map(url => fetchServerAgents(url)));
allAgents = results.flatMap(r => r.agents);
allHubs = results.map(r => r.hub).filter(Boolean);
// Fetch status for all running agents in background
fetchAllAgentStatuses();
// Return local server status
return results[0].status;
}

async function fetchAllAgentStatuses() {
const running = allAgents.filter(a => a.running && a.url);
await Promise.all(running.map(async (agent) => {
  try {
    const token = getServerToken(agent.server || location.origin);
    const res = await fetch(`${agent.url}/status`, { headers: AgentClient._headers(token) });
    if (res.ok) {
      const conn = getAgentConn(agent.name);
      conn.statusData = await res.json();
    }
  } catch { /* ignore */ }
}));
renderSwitcher();
}

// Get all agents (use cached results from last discover)
function getAllAgents() {
return allAgents;
}

function setupSwitcher() {
$('menu-btn').addEventListener('click', async () => {
  await discoverAllAgents();
  renderSwitcher();
  toggleSidebar();
});
$('sidebar-backdrop').addEventListener('click', () => {
  closeSidebar();
});
$('add-server-btn').addEventListener('click', async () => {
  const url = $('add-url').value.trim().replace(/\/$/, '');
  const token = $('add-token').value.trim() || null;
  if (!url) return;
  if (url === location.origin) {
    $('add-url').style.borderColor = 'var(--red)';
    setTimeout(() => $('add-url').style.borderColor = '', 2000);
    return;
  }
  // Save token first so fetchServerAgents can use it
  const servers = getSavedServers();
  const existing = servers.findIndex(s => s.url === url);
  if (existing >= 0) {
    servers[existing] = { url, token };
  } else {
    servers.push({ url, token });
  }
  saveServers(servers);
  // Validate by fetching agents
  const result = await fetchServerAgents(url);
  if (result.agents.length === 0) {
    // Remove if validation failed
    saveServers(servers.filter(s => s.url !== url));
    $('add-url').style.borderColor = 'var(--red)';
    setTimeout(() => $('add-url').style.borderColor = '', 2000);
    return;
  }
  $('add-url').value = '';
  $('add-token').value = '';
  $('add-modal').classList.remove('open');
  await discoverAllAgents();
  renderSwitcher();
});
$('add-cancel-btn').addEventListener('click', () => {
  $('add-modal').classList.remove('open');
  $('add-url').value = '';
  $('add-token').value = '';
});
$('add-modal').addEventListener('click', (e) => {
  if (e.target === $('add-modal')) {
    $('add-modal').classList.remove('open');
    $('add-url').value = '';
    $('add-token').value = '';
  }
});
}

let busy = false;
let streamingText = '';
let streamingEl = null;
let _streamRaf = 0;
let connection = null;
let authFailed = false;
let intentionalClose = false;
let activeEventSource = null;
let currentTurnContext = null; // tracks which interface/type triggered the current turn
let lastToolEl = null; // last tool call element — kept expanded during streaming
let isLoadingHistory = false; // suppress auto-expand during history load

// --- Render helpers ---

let userScrolledUp = false;

const scrollDownBtn = $('scroll-down-btn');
const scrollContainer = $('messages-scroll');

scrollContainer.addEventListener('scroll', () => {
const threshold = 80;
const atBottom = scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight < threshold;
if (!autoScrolling) {
  userScrolledUp = !atBottom;
}
scrollDownBtn.classList.toggle('visible', userScrolledUp);
});

scrollDownBtn.addEventListener('click', () => scrollToBottom(true));

window.addEventListener('resize', () => { updateScrollBtnPosition(); scrollToBottom(); });

function updateScrollBtnPosition() {
const inputArea = document.querySelector('.input-area');
if (inputArea) scrollDownBtn.style.bottom = (inputArea.offsetHeight + 12) + 'px';
}

let autoScrolling = false;
let autoScrollRelease = null;

function scrollToBottom(force) {
if (!(force || !userScrolledUp)) return;

autoScrolling = true;
if (autoScrollRelease) clearTimeout(autoScrollRelease);

const applyScroll = () => {
  scrollContainer.scrollTop = scrollContainer.scrollHeight;
};

applyScroll();
requestAnimationFrame(() => {
  applyScroll();
  requestAnimationFrame(applyScroll);
});

autoScrollRelease = setTimeout(() => {
  autoScrolling = false;
  autoScrollRelease = null;
}, 80);
}

function formatBashCommand(cmd) {
// Syntax highlight with hljs if available
let html;
if (typeof hljs !== 'undefined') {
  html = hljs.highlight(cmd, { language: 'bash' }).value;
} else {
  html = escapeHtml(cmd);
}
// Break long commands at &&, ||, |, ; with indented continuation
if (cmd.length >= 60) {
  html = html
    .replace(/ &amp;&amp; /g, ' &amp;&amp;\n')
    .replace(/ \|\| /g, ' ||\n')
    .replace(/ \| /g, ' | ')
    .replace(/ ; /g, ';\n')
    .replace(/ \\\n/g, ' \\\n');
}
// Step 1: Break into lines first, then process each line
const lines = html.split('\n');
html = lines.map((line, i) => {
  const trimmed = line.replace(/^ +/, '');
  const indent = line.slice(0, line.length - trimmed.length);
  if (i === 0) {
    // First line: highlight leading command if not already in a span
    return line.replace(/^([a-zA-Z0-9_./-]+)(?![^<]*<\/span)/, '<span class="hljs-built_in">$1</span>');
  }
  // Continuation lines: highlight first plain word (the command after separator)
  return indent + trimmed.replace(/^([a-zA-Z0-9_./-]+)(?![^<]*<\/span)/, '<span class="hljs-built_in">$1</span>');
}).join('\n');
// Highlight separators in muted style
const sepStyle = 'color:#768390';
html = html.replace(/ (&amp;&amp;)(\n|$)/g, ` <span style="${sepStyle}">$1</span>$2`);
html = html.replace(/ (\|\|)(\n|$)/g, ` <span style="${sepStyle}">$1</span>$2`);
html = html.replace(/ (\|) /g, ` <span style="${sepStyle}">$1</span> `);
html = html.replace(/(;)(\n|$)/g, `<span style="${sepStyle}">$1</span>$2`);
return html;
}

const TOOL_COLORS = {
bash: 'var(--tool-bash)', read: 'var(--tool-read)', write: 'var(--tool-write)',
edit: 'var(--tool-edit)', glob: 'var(--tool-glob)', grep: 'var(--tool-grep)',
webfetch: 'var(--tool-webfetch)', kern: 'var(--tool-kern)', message: 'var(--tool-message)',
pdf: 'var(--tool-read)', websearch: 'var(--tool-webfetch)', recall: 'var(--tool-kern)', image: 'var(--tool-read)',
};

function escapeHtml(s) {
return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Convert ANSI escape sequences to HTML spans
function ansiToHtml(s) {
const ANSI_COLORS = {
  '30': '#545454', '31': '#fc533a', '32': '#3fb950', '33': '#d29922',
  '34': '#58a6ff', '35': '#bc8cff', '36': '#56d4dd', '37': '#e6edf3',
  '90': '#707070', '91': '#f97583', '92': '#56d364', '93': '#e3b341',
  '94': '#79c0ff', '95': '#d2a8ff', '96': '#76e3ea', '97': '#ffffff',
};
let html = escapeHtml(s);
let open = false;
html = html.replace(/\x1b\[([0-9;]*)m/g, (_, codes) => {
  const parts = codes.split(';').filter(Boolean);
  if (parts.length === 0 || (parts.length === 1 && parts[0] === '0')) {
    return open ? (open = false, '</span>') : '';
  }
  let color = null;
  let bold = false;
  for (const p of parts) {
    if (p === '1') bold = true;
    else if (ANSI_COLORS[p]) color = ANSI_COLORS[p];
  }
  if (!color && !bold) return open ? (open = false, '</span>') : '';
  const prefix = open ? '</span>' : '';
  open = true;
  const style = (color ? `color:${color};` : '') + (bold ? 'font-weight:bold;' : '');
  return `${prefix}<span style="${style}">`;
});
if (open) html += '</span>';
// Strip any remaining escape sequences
html = html.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
return html;
}

// File extension → highlight.js language mapping
const EXT_LANG = {
ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
py: 'python', rb: 'ruby', go: 'go', rs: 'rust', c: 'c', cpp: 'cpp', h: 'cpp',
java: 'java', kt: 'kotlin', cs: 'csharp', swift: 'swift',
sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash',
json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'ini',
html: 'xml', xml: 'xml', svg: 'xml', css: 'css', scss: 'css',
md: 'markdown', sql: 'sql', dockerfile: 'dockerfile',
conf: 'ini', ini: 'ini', env: 'ini', nginx: 'nginx',
lua: 'lua', php: 'php', r: 'r', zig: 'rust',
};

function getLanguageFromPath(path) {
if (!path) return null;
const name = path.split('/').pop().toLowerCase();
if (name === 'dockerfile') return 'dockerfile';
if (name === 'makefile') return 'makefile';
const ext = name.split('.').pop();
return EXT_LANG[ext] || null;
}

// Format read tool output with line numbers gutter + syntax highlighting
function formatReadOutput(text, filePath) {
const lines = text.split('\n');
const lineNums = [];
const codeLines = [];

for (const line of lines) {
  const match = line.match(/^(\d+):(.*)/);
  if (match) {
    lineNums.push(match[1]);
    codeLines.push(match[2]);
  } else {
    // Directory listing or non-numbered output — skip formatting
    return null;
  }
}

const code = codeLines.join('\n');
const lang = getLanguageFromPath(filePath);

let highlighted;
if (typeof hljs !== 'undefined' && lang) {
  try {
    highlighted = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
  } catch {
    highlighted = escapeHtml(code);
  }
} else {
  highlighted = escapeHtml(code);
}

const gutter = lineNums.map(n => escapeHtml(n)).join('\n');
return `<div class="read-output"><div class="read-gutter">${gutter}</div><div class="read-code">${highlighted}</div></div>`;
}

function formatEditDiff(input) {
if (!input || !input.oldString || !input.newString) return null;
const lang = getLanguageFromPath(input.path);

function highlightLines(text) {
  if (typeof hljs !== 'undefined' && lang) {
    try {
      const highlighted = hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
      return highlighted.split('\n');
    } catch {}
  }
  return text.split('\n').map(l => escapeHtml(l));
}

const oldHL = highlightLines(input.oldString);
const newHL = highlightLines(input.newString);

const oldLines = oldHL.map(l => `<div class="diff-line-old"><span class="diff-gutter">−</span><span class="diff-code">${l || ' '}</span></div>`);
const newLines = newHL.map(l => `<div class="diff-line-new"><span class="diff-gutter">+</span><span class="diff-code">${l || ' '}</span></div>`);
return oldLines.join('') + '<div class="diff-separator"></div>' + newLines.join('');
}

function formatTime(date) {
if (!date) return null;
const d = date instanceof Date ? date : new Date(date);
if (isNaN(d)) return null;
const now = new Date();
const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
if (d.toDateString() === now.toDateString()) return time;
return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + time;
}

// Add expand-to-fullscreen button to a tool message's header (only shows if output overflows)
function addExpandBtn(toolEl) {
const header = toolEl.querySelector('.tool-header');
const outputEl = toolEl.querySelector('.tool-output');
if (!header || !outputEl || header.querySelector('.tool-expand-btn')) return;
const btn = document.createElement('button');
btn.className = 'tool-expand-btn';
btn.innerHTML = '⛶';
btn.title = 'Fullscreen';
btn.addEventListener('click', (e) => {
  e.stopPropagation();
  openFullscreen(outputEl);
});
header.appendChild(btn);
// Check overflow after render (needs to be visible)
checkExpandOverflow(toolEl);
}

function checkExpandOverflow(toolEl) {
const btn = toolEl.querySelector('.tool-expand-btn');
const outputEl = toolEl.querySelector('.tool-output');
if (!btn || !outputEl) return;
requestAnimationFrame(() => {
  if (outputEl.scrollHeight > outputEl.clientHeight + 2) {
    btn.classList.add('has-overflow');
  } else {
    btn.classList.remove('has-overflow');
  }
});
}

function openFullscreen(outputEl) {
const overlay = document.createElement('div');
overlay.className = 'fullscreen-overlay';
const content = document.createElement('div');
content.className = 'fullscreen-content';
const closeBtn = document.createElement('button');
closeBtn.className = 'fullscreen-close';
closeBtn.innerHTML = '✕';
closeBtn.addEventListener('click', () => overlay.remove());
content.appendChild(closeBtn);
const inner = document.createElement('div');
inner.innerHTML = outputEl.innerHTML;
content.appendChild(inner);
overlay.appendChild(content);
overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
document.body.appendChild(overlay);
const onKey = (e) => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey); } };
document.addEventListener('keydown', onKey);
}

function isEmojiOnly(text) {
const trimmed = text.trim();
const emojiPattern = /^(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F){1,3}$/u;
return emojiPattern.test(trimmed);
}

function addMessage(type, content, meta, toolInput, timestamp, iface) {
const el = document.createElement('div');
el.className = `message ${type}`;
// Set turn context on trigger messages
if (type === 'user' || type === 'user-remote' || type === 'incoming' || type === 'heartbeat') {
  currentTurnContext = iface || type;
}
// Tag all messages with the current turn context
if (iface) el.classList.add(`from-${iface}`);
else if (currentTurnContext) el.classList.add(`from-${currentTurnContext}`);
if (type === 'tool') {
  const spaceIdx = content.indexOf(' ');
  const toolName = spaceIdx > 0 ? content.slice(0, spaceIdx) : content;
  const toolDetail = spaceIdx > 0 ? content.slice(spaceIdx) : '';
  const color = TOOL_COLORS[toolName] || 'var(--text-dim)';
  el.style.borderLeftColor = color;
  el.dataset.toolName = toolName;
  if (toolInput && toolInput.path) el.dataset.toolPath = toolInput.path;
  if (toolName === 'bash') {
    el.classList.add('tool-bash-style');
    const fmtCmd = formatBashCommand(toolDetail.trim());
    el.innerHTML = `<div class="tool-header"><span class="tool-prompt">$</span><span class="tool-detail">${fmtCmd}</span></div><div class="tool-output"></div>`;
  } else {
    el.innerHTML = `<div class="tool-header"><span class="tool-arrow">&#9654;</span><span class="tool-name" style="color:${color}">${toolName}</span><span class="tool-detail">${toolDetail}</span></div><div class="tool-output"></div>`;
  }
  // Pre-fill tool output from input for specific tools
  if (toolName === 'edit' && toolInput) {
    const diff = formatEditDiff(toolInput);
    if (diff) {
      el.querySelector('.tool-output').innerHTML = diff;
    }
  } else if (toolName === 'write' && toolInput && toolInput.content) {
    const writeLang = getLanguageFromPath(toolInput.path);
    if (typeof hljs !== 'undefined' && writeLang) {
      try {
        el.querySelector('.tool-output').innerHTML = hljs.highlight(toolInput.content, { language: writeLang, ignoreIllegals: true }).value;
      } catch {
        el.querySelector('.tool-output').textContent = toolInput.content;
      }
    } else {
      el.querySelector('.tool-output').textContent = toolInput.content;
    }
  } else if (toolName === 'message' && toolInput && toolInput.text) {
    el.querySelector('.tool-output').textContent = `→ ${toolInput.interface || 'unknown'}: ${toolInput.text}`;
  }
  el.addEventListener('click', () => { el.classList.toggle('expanded'); checkExpandOverflow(el); });
  // Auto-expand last tool call during streaming, collapse previous
  if (!isLoadingHistory) {
    if (lastToolEl) lastToolEl.classList.remove('expanded');
    el.classList.add('expanded');
    lastToolEl = el;
  }
} else if (type === 'user-remote') {
  if (meta) {
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = meta;
    el.appendChild(label);
  }
  el.appendChild(document.createTextNode(content));
} else if (type === 'incoming') {
  if (meta) {
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = meta;
    el.appendChild(label);
  }
  const text = document.createElement('span');
  text.innerHTML = renderMarkdown(content);
  el.appendChild(text);
} else if (type === 'outgoing') {
  if (meta) {
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = meta;
    el.appendChild(label);
  }
  const text = document.createElement('span');
  text.innerHTML = renderMarkdown(content);
  el.appendChild(text);
} else if (type === 'heartbeat') {
  el.textContent = content || '\u2661 heartbeat';
} else if (type === 'command-result') {
  el.textContent = content;
} else if (type === 'system') {
  el.textContent = content;
} else {
  const isMuted = type === 'assistant' && (content.trim() === 'NO_REPLY' || content.trim() === '(no text response)');
  if (isMuted) el.classList.add('muted');
  if ((type === 'user' || type === 'assistant') && isEmojiOnly(content)) {
    el.classList.add('emoji-only');
    el.textContent = content.trim();
  } else {
    el.innerHTML = renderMarkdown(content);
  }
}
messagesEl.appendChild(el);
if (timestamp && (type === 'user' || type === 'incoming' || type === 'outgoing')) {
  const ts = formatTime(timestamp);
  if (ts) {
    const tsEl = document.createElement('div');
    const side = (type === 'user' || type === 'incoming') ? 'ts-right' : 'ts-left';
    const ctx = currentTurnContext ? `from-${currentTurnContext}` : '';
    tsEl.className = `timestamp ${side} ${ctx}`;
    tsEl.textContent = ts;
    messagesEl.appendChild(tsEl);
  }
}
scrollToBottom();
return el;
}

function flushStreaming() {
if (streamingEl && streamingText) {
  streamingEl.classList.remove('streaming-cursor');
  const isMuted = streamingText.trim() === 'NO_REPLY' || streamingText.trim() === '(no text response)';
  if (isMuted) streamingEl.classList.add('muted');
  if (isEmojiOnly(streamingText)) {
    streamingEl.classList.add('emoji-only');
    streamingEl.textContent = streamingText.trim();
  } else {
    streamingEl.innerHTML = renderMarkdown(streamingText);
  }
}
streamingText = '';
streamingEl = null;
if (_streamRaf) { cancelAnimationFrame(_streamRaf); _streamRaf = 0; }
}

function setBusy(b) {
busy = b;
sendBtn.disabled = !inputEl.value.trim() && pendingAttachments.length === 0;
if (!b) hideThinking();
}

function updateTitle(busy) {
const name = getActiveAgent() || 'kern';
document.title = busy ? `${name} ⋯` : name;
}

function showThinking() {
if ($('thinking')) return;
const el = document.createElement('div');
el.className = 'message-thinking';
el.id = 'thinking';
el.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
messagesEl.appendChild(el);
scrollToBottom();
updateTitle(true);
}

function hideThinking() {
const el = $('thinking');
if (el) el.remove();
updateTitle(false);
}

function setConnected(state) {
statusDot.className = `status-dot ${state}`;
}

// --- Event handling ---

function handleEvent(event) {
switch (event.type) {
  case 'thinking':
    setBusy(true);
    if (activeName) setAgentThinking(activeName, true);
    showThinking();
    break;

  case 'text-delta':
    if (!streamingEl) {
      hideThinking();
    }
    if (!streamingEl) {
      if (lastToolEl) { lastToolEl.classList.remove('expanded'); lastToolEl = null; }
      streamingEl = addMessage('assistant', '');
      streamingEl.classList.add('streaming-cursor');
    }
    streamingText += event.text || '';
    // Debounce render to avoid layout thrash on every delta (helps mobile input lag)
    if (!_streamRaf) {
      _streamRaf = requestAnimationFrame(() => {
        _streamRaf = 0;
        if (streamingEl) {
          if (isEmojiOnly(streamingText)) {
            streamingEl.classList.add('emoji-only');
            streamingEl.textContent = streamingText.trim();
          } else {
            streamingEl.classList.remove('emoji-only');
            // Only modify .message-body if it exists, otherwise just set innerHTML
            const body = streamingEl.querySelector('.message-body');
            if (body) {
              body.innerHTML = renderMarkdown(streamingText);
            } else {
              streamingEl.innerHTML = renderMarkdown(streamingText);
            }
          }
          scrollToBottom(true);
          requestAnimationFrame(() => scrollToBottom(true));
        }
        
        if (activeName) setAgentThinking(activeName, true);
      });
    }
    setBusy(true);
    break;

  case 'tool-call': {
    flushStreaming();
    hideThinking();
    const detail = event.toolDetail ? ` ${event.toolDetail}` : '';
    addMessage('tool', `${event.toolName}${detail}`, null, event.toolInput);
    setBusy(true);
    if (activeName) setAgentThinking(activeName, true);
    showThinking();
    break;
  }

  case 'tool-result': {
    // Find the last tool message and attach the result
    const toolMsgs = messagesEl.querySelectorAll('.message.tool');
    if (toolMsgs.length > 0) {
      const lastTool = toolMsgs[toolMsgs.length - 1];
      const outputEl = lastTool.querySelector('.tool-output');
      if (outputEl && event.toolResult) {
        const text = event.toolResult.length > 5000
          ? event.toolResult.slice(0, 5000) + '\n... (truncated)'
          : event.toolResult;
        // Try syntax-highlighted read output
        const toolName = lastTool.dataset.toolName;
        const toolPath = lastTool.dataset.toolPath;
        if (toolName === 'read' && !outputEl.innerHTML) {
          const formatted = formatReadOutput(text, toolPath);
          if (formatted) {
            outputEl.innerHTML = formatted;
          } else {
            outputEl.innerHTML = ansiToHtml(text);
          }
        } else if (outputEl.innerHTML) {
          outputEl.innerHTML += `<div class="tool-result-text">${ansiToHtml(text)}</div>`;
        } else {
          outputEl.innerHTML = ansiToHtml(text);
        }
        addExpandBtn(lastTool);
      }
    }
    scrollToBottom();
    // Agent is thinking about what to do next — show dots
    if (activeName) setAgentThinking(activeName, true);
    showThinking();
    break;
  }

  case 'recall': {
    hideThinking();
    const r = event.recall;
    if (r && r.chunks > 0) {
      const el = document.createElement('div');
      el.className = 'message recall';
      el.setAttribute('data-type', 'recall');
      const queryPreview = r.query ? r.query.replace(/\[via [^\]]+\]\s*/g, '').slice(0, 80) : '';
      const summary = `📎 ${r.chunks} memor${r.chunks === 1 ? 'y' : 'ies'} recalled (~${r.tokens} tokens)${queryPreview ? ` — "${escapeHtml(queryPreview)}"` : ''}`;
      const details = r.results.map(res => {
        const time = res.timestamp ? new Date(res.timestamp).toLocaleString() : '';
        const text = res.text.length > 300 ? res.text.slice(0, 300) + '...' : res.text;
        return `<div class="recall-chunk"><span class="recall-time">${escapeHtml(time)}</span>\n${escapeHtml(text)}</div>`;
      }).join('');
      el.innerHTML = `<div class="recall-header"><span class="tool-arrow">&#9654;</span><span class="recall-summary">${summary}</span></div><div class="recall-details">${details}</div>`;
      el.addEventListener('click', () => el.classList.toggle('expanded'));
      messagesEl.appendChild(el);
      scrollToBottom();
    }
    if (activeName) setAgentThinking(activeName, true);
    showThinking();
    break;
  }

  case 'finish':
    flushStreaming();
    hideThinking();
    if (activeName) setAgentThinking(activeName, false);
    setBusy(false);
    fetchAndCacheStatus(); // refresh pinned stats
    break;

  case 'error':
    flushStreaming();
    hideThinking();
    addMessage('error', event.error || 'Unknown error');
    setBusy(false);
    break;

  case 'incoming': {
    const isLocal = event.fromInterface === 'web' || event.fromInterface === 'tui';
    const source = event.fromInterface === 'tui' ? 'terminal' : event.fromInterface;
    const label = isLocal ? `via ${source}` : `${event.fromInterface} ${event.fromUserId || ''}`.trim();
    addMessage(isLocal ? 'user-remote' : 'incoming',
      event.text || '', label,
      null, new Date(), isLocal ? 'user-remote' : 'incoming');
    break;
  }

  case 'outgoing':
    addMessage('outgoing',
      event.text || '',
      `[→ ${event.fromInterface} ${event.fromUserId || ''}]`,
      null, new Date());
    break;

  case 'heartbeat':
    addMessage('heartbeat', '\u2661 heartbeat');
    break;

  case 'command-result':
    hideThinking();
    addMessage('command-result', event.text || '');
    setBusy(false);
    break;
}
}

// --- Send ---

async function send() {
const text = inputEl.value.trim();
const hasAttachments = pendingAttachments.length > 0;
if (!text && !hasAttachments) return;

// Collect attachments before clearing
const attachments = pendingAttachments.map(att => ({
  type: att.type,
  mimeType: att.mimeType,
  filename: att.filename,
  size: att.size,
  data: att.base64,
  dataUrl: att.dataUrl,
}));

inputEl.value = '';
inputEl.style.height = 'auto';
pendingAttachments = [];
renderAttachmentPreviews();
sendBtn.disabled = true;

// Show text bubble if there's text
if (text) {
  addMessage('user', text, null, null, new Date(), 'web');
}
// Show media as separate bubble
if (hasAttachments) {
  const mediaEl = document.createElement('div');
  mediaEl.className = 'message user-media';
  const mc = document.createElement('div');
  mc.className = 'media-attachments';
  for (const att of attachments) {
    if ((att.type === 'image' || att.mimeType?.startsWith('image/')) && att.dataUrl) {
      const img = document.createElement('img');
      img.src = att.dataUrl;
      img.className = 'media-image';
      img.alt = att.filename;
      img.onload = () => scrollToBottom();
      mc.appendChild(img);
    } else {
      const icon = att.type === 'video' ? '🎬' : att.type === 'audio' ? '🎵' : '📄';
      const lbl = document.createElement('span');
      lbl.className = 'media-file';
      lbl.textContent = `${icon} ${att.filename}`;
      mc.appendChild(lbl);
    }
  }
  mediaEl.appendChild(mc);
  messagesEl.appendChild(mediaEl);
}
scrollToBottom(true);

try {
  setBusy(true);
  showThinking();
  const opts = { connectionId: connection?.connectionId };
  if (attachments.length > 0) opts.attachments = attachments;
  await AgentClient.sendMessage(BASE_URL, AUTH_TOKEN, text || '', opts);
} catch (err) {
  addMessage('error', `Failed to send: ${err.message}`);
  if (!busy) setBusy(false);
}
}

// --- Slash command autocomplete ---

const SLASH_COMMANDS = [
{ name: '/status', desc: 'agent status, uptime, token usage' },
{ name: '/restart', desc: 'restart the agent process' },
{ name: '/help', desc: 'list available commands' },
];

const cmdPopup = $('cmd-popup');
let cmdSelectedIdx = 0;
let cmdFiltered = [];

function updateCmdPopup() {
const val = inputEl.value;
const trigger = val.trim().toLowerCase();
// Show popup only when input starts with / and is a single word (no spaces)
if (!trigger.startsWith('/') || trigger.includes(' ')) {
  cmdPopup.classList.remove('open');
  cmdPopup.style.display = 'none';
  inputEl.closest('.input-row')?.classList.remove('popup-open');
  cmdFiltered = [];
  return;
}
const query = trigger;
cmdFiltered = SLASH_COMMANDS.filter(c => c.name.startsWith(query));
if (cmdFiltered.length === 0) {
  cmdPopup.classList.remove('open');
  cmdPopup.style.display = 'none';
  inputEl.closest('.input-row')?.classList.remove('popup-open');
  return;
}
cmdSelectedIdx = Math.max(0, Math.min(cmdSelectedIdx, cmdFiltered.length - 1));
cmdPopup.innerHTML = cmdFiltered.map((c, i) =>
  `<div class="cmd-item${i === cmdSelectedIdx ? ' selected' : ''}" data-idx="${i}">` +
  `<span class="cmd-item-name">${c.name}</span>` +
  `<span class="cmd-item-desc">${c.desc}</span>` +
  `</div>`
).join('');
cmdPopup.classList.add('open');
cmdPopup.style.display = 'block';
inputEl.closest('.input-row')?.classList.add('popup-open');
const inputRect = inputEl.getBoundingClientRect();
const rowRect = inputEl.closest('.input-row')?.getBoundingClientRect();
const keyboardOffset = window.visualViewport
  ? Math.max(0, window.innerHeight - window.visualViewport.height - window.visualViewport.offsetTop)
  : 0;
if (rowRect && inputRect.bottom > window.innerHeight - 260) {
  cmdPopup.style.top = 'auto';
  cmdPopup.style.bottom = `calc(100% + ${8 + keyboardOffset}px)`;
} else {
  cmdPopup.style.bottom = 'calc(100% + 8px)';
}
}

cmdPopup.addEventListener('click', (e) => {
const item = e.target.closest('.cmd-item');
if (!item) return;
const idx = parseInt(item.dataset.idx);
const cmd = cmdFiltered[idx];
if (cmd) {
  inputEl.value = cmd.name;
  cmdPopup.classList.remove('open');
  cmdPopup.style.display = 'none';
  inputEl.closest('.input-row')?.classList.remove('popup-open');
  send();
}
});

// --- Input ---

let _inputRaf = 0;
let isComposing = false;

inputEl.addEventListener('compositionstart', () => {
isComposing = true;
});

inputEl.addEventListener('compositionend', () => {
isComposing = false;
updateCmdPopup();
});

inputEl.addEventListener('input', () => {
// Batch all DOM work into a single frame to avoid keystroke lag on mobile
if (!_inputRaf) {
  _inputRaf = requestAnimationFrame(() => {
    _inputRaf = 0;
    sendBtn.disabled = !inputEl.value.trim() && pendingAttachments.length === 0;
    if (!isComposing) updateCmdPopup();
    inputEl.style.height = 'auto';
    inputEl.style.height = inputEl.scrollHeight + 'px';
    inputEl.style.overflowY = inputEl.scrollHeight > inputEl.offsetHeight ? 'auto' : 'hidden';
    updateScrollBtnPosition();
  });
}
});

inputEl.addEventListener('focus', () => {
updateCmdPopup();
});

inputEl.addEventListener('click', () => {
updateCmdPopup();
});

inputEl.addEventListener('blur', () => {
setTimeout(() => {
  cmdPopup.classList.remove('open');
  cmdPopup.style.display = 'none';
  inputEl.closest('.input-row')?.classList.remove('popup-open');
}, 120);
});

inputEl.addEventListener('keydown', (e) => {
// Arrow navigation in command popup
if (cmdPopup.classList.contains('open')) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    cmdSelectedIdx = Math.min(cmdSelectedIdx + 1, cmdFiltered.length - 1);
    updateCmdPopup();
    return;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    cmdSelectedIdx = Math.max(cmdSelectedIdx - 1, 0);
    updateCmdPopup();
    return;
  }
  if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
    e.preventDefault();
    const cmd = cmdFiltered[cmdSelectedIdx];
    if (cmd) {
      inputEl.value = cmd.name;
      cmdPopup.classList.remove('open');
      cmdPopup.style.display = 'none';
      inputEl.closest('.input-row')?.classList.remove('popup-open');
      if (e.key === 'Enter') send();
    }
    return;
  }
  if (e.key === 'Escape') {
    cmdPopup.classList.remove('open');
    cmdPopup.style.display = 'none';
    inputEl.closest('.input-row')?.classList.remove('popup-open');
    return;
  }
}
if (e.key === 'Enter' && !e.shiftKey) {
  e.preventDefault();
  send();
}
});

sendBtn.addEventListener('click', send);

// --- Connect ---

let reconnectTimer = null;

async function init() {
// Cancel any pending reconnect
if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
// Close existing connection
intentionalClose = true;
if (connection) { connection.close(); connection = null; }
// Safety close for orphaned EventSource
if (activeEventSource) {
  activeEventSource.close();
  activeEventSource = null;
}
intentionalClose = false;
// Clear previous messages to avoid duplicates on reconnect
flushStreaming();
hideThinking();
messagesEl.innerHTML = '';
streamingText = '';
streamingEl = null;
lastToolEl = null;
setConnected('connecting');

// Load status — also serves as auth check
try {
  const res = await fetch(`${BASE_URL}/status`, { headers: AgentClient._headers(AUTH_TOKEN) });
  if (res.status === 401) {
    authFailed = true;
    setConnected('disconnected');
    // Re-prompt for token
    await showTokenPrompt();
    AUTH_TOKEN = getServerToken(location.origin);
    authFailed = false;
    init();
    return;
  }
  const status = await res.json();
  const resolvedName = status.agentName || 'kern';
  agentNameEl.textContent = resolvedName;
  setActiveAgent(resolvedName);
  if (status.version) $('sidebar-version').textContent = 'v' + status.version;
  lastStatusData = status;
  renderHeaderStats();
} catch {
  agentNameEl.textContent = 'kern';
  lastStatusData = null;
  renderHeaderStats();
}

// Load history
try {
  const history = await AgentClient.getHistory(BASE_URL, AUTH_TOKEN, 100);
  isLoadingHistory = true;
  // Build tool result map: toolCallId → output string
  const toolResults = {};
  for (const msg of history) {
    if (msg.role === 'tool' && Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === 'tool-result' && part.toolCallId) {
          const output = part.output;
          toolResults[part.toolCallId] = typeof output === 'string' ? output
            : (output && output.value) ? String(output.value)
            : JSON.stringify(output);
        }
      }
    }
  }
  for (const msg of history) {
    if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        const parsed = parseHistoryUserMessage(msg.content);
        if (parsed) addMessage(parsed.type, parsed.text, parsed.meta, null, parsed.timestamp, parsed.iface);
      } else if (Array.isArray(msg.content)) {
        // SDK-native content array (text + media parts)
        let text = '';
        const mediaParts = [];
        for (const part of msg.content) {
          if (part.type === 'text') text += (text ? '\n' : '') + part.text;
          else if (part.type === 'image') mediaParts.push(part);
          else if (part.type === 'file') mediaParts.push(part);
        }
        const parsed = parseHistoryUserMessage(text);
        const hasMedia = mediaParts.length > 0;
        if (parsed && !(hasMedia && (parsed.text === '(empty)' || !parsed.text.trim()))) {
          addMessage(parsed.type, parsed.text, parsed.meta, null, parsed.timestamp, parsed.iface);
        }
        if (mediaParts.length > 0) {
          const mediaEl = document.createElement('div');
          mediaEl.className = 'message user-media';
          const mediaContainer = document.createElement('div');
          mediaContainer.className = 'media-attachments';
          for (const mp of mediaParts) {
            if (mp.type === 'image') {
              const file = (typeof mp.image === 'string' && mp.image.startsWith('kern-media://'))
                ? mp.image.slice('kern-media://'.length) : null;
              if (file) {
                const img = document.createElement('img');
                img.src = `${BASE_URL}/media/${file}${AUTH_TOKEN ? '?token=' + AUTH_TOKEN : ''}`;
                img.className = 'media-image';
                img.alt = file;
                img.loading = 'lazy';
                img.onload = () => scrollToBottom();
                mediaContainer.appendChild(img);
              }
            } else if (mp.type === 'file') {
              const file = (typeof mp.data === 'string' && mp.data.startsWith('kern-media://'))
                ? mp.data.slice('kern-media://'.length) : null;
              const label = mp.filename || file || 'file';
              const link = document.createElement('a');
              link.href = file ? `${BASE_URL}/media/${file}${AUTH_TOKEN ? '?token=' + AUTH_TOKEN : ''}` : '#';
              link.className = 'media-file';
              link.textContent = `📎 ${label}`;
              link.target = '_blank';
              mediaContainer.appendChild(link);
            }
          }
          mediaEl.appendChild(mediaContainer);
          messagesEl.appendChild(mediaEl);
        }
      }
    } else if (msg.role === 'assistant') {
      if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'text' && part.text) {
            addMessage('assistant', part.text);
          } else if (part.type === 'tool-call') {
            const input = part.input || {};
            let detail = input.path || input.command || input.pattern || input.url || input.action || input.query || input.userId || input.file || '';
            if (input.pages) detail += ` pages:${input.pages}`;
            if (input.prompt && (part.toolName === 'pdf' || part.toolName === 'image')) detail += ` "${String(input.prompt).slice(0, 60)}"`;
            if (input.offset) detail += ` +${input.offset}`;
            if (input.limit && input.limit !== 2000) detail += ` limit:${input.limit}`;
            const el = addMessage('tool', `${part.toolName} ${detail}`, null, input);
            // Attach result if available (for non-edit tools, or append to edit diff)
            const result = toolResults[part.toolCallId];
            if (result && el) {
              const outputEl = el.querySelector('.tool-output');
              if (outputEl) {
                const truncated = result.length > 5000
                  ? result.slice(0, 5000) + '\n... (truncated)'
                  : result;
                if (part.toolName === 'read' && !outputEl.innerHTML) {
                  const formatted = formatReadOutput(truncated, input.path);
                  if (formatted) {
                    outputEl.innerHTML = formatted;
                  } else {
                    outputEl.innerHTML = ansiToHtml(truncated);
                  }
                } else if (outputEl.innerHTML) {
                  // Already has content (edit diff, write content, etc) — append result
                  outputEl.innerHTML += `<div class="tool-result-text">${ansiToHtml(truncated)}</div>`;
                } else {
                  outputEl.innerHTML = ansiToHtml(truncated);
                }
                addExpandBtn(el);
              }
            }
          }
        }
      } else if (typeof msg.content === 'string') {
        addMessage('assistant', msg.content);
      }
    }
  }
} catch {}
isLoadingHistory = false;
scrollToBottom(true);

// If agent is mid-turn, show thinking indicator
try {
  const status = await AgentClient.getStatus(BASE_URL, AUTH_TOKEN);
  if (status.queue && status.queue.startsWith('busy')) {
    setBusy(true);
    showThinking();
  }
} catch {}

// Track active agent connection
const activeName = getActiveAgent();
const activeConn = getAgentConn(activeName);
clearIdleTimer(activeName);
activeConn.unread = 0;

// Connect SSE — if native bridge is active, skip EventSource (native handles SSE)
if (window.KernNative) {
  connection = { close() {}, connectionId: null };
  // Tell native to start SSE — bridge script may not have run yet
  if (window.KernNative.switchAgent) {
    KernNative.switchAgent(BASE_URL, AUTH_TOKEN || '');
  }
} else {
  connection = AgentClient.connect(BASE_URL, AUTH_TOKEN, {
    onEvent: handleEvent,
    onConnect() {
      setConnected('connected');
      renderSwitcher();
    },
    async onDisconnect() {
      if (authFailed || intentionalClose) return;
      setConnected('disconnected');
      addMessage('system', 'disconnected — reconnecting...');
      // Re-discover agents (proxy URL is stable, but agent may have stopped)
      await discoverAllAgents();
      reconnectTimer = setTimeout(init, 2000);
    },
  });
}
}

setupSwitcher();

// --- Filters ---
const FILTERS = [
{ key: 'heartbeat', label: 'Heartbeats', default: false },
{ key: 'tui', label: 'TUI messages', default: true },
{ key: 'tools', label: 'Tool calls', default: true },
{ key: 'incoming', label: 'Telegram / Slack', default: true },
{ key: 'system', label: 'System messages', default: true },
];

function getFilters() {
try {
  const saved = JSON.parse(localStorage.getItem('kern_filters') || '{}');
  const result = {};
  for (const f of FILTERS) result[f.key] = f.key in saved ? saved[f.key] : f.default;
  return result;
} catch { return Object.fromEntries(FILTERS.map(f => [f.key, f.default])); }
}

function saveFilters(filters) {
localStorage.setItem('kern_filters', JSON.stringify(filters));
}

function applyFilters() {
const filters = getFilters();
const el = messagesEl;
el.classList.toggle('hide-heartbeat', !filters.heartbeat);
el.classList.toggle('hide-tui', !filters.tui);
el.classList.toggle('hide-tools', !filters.tools);
el.classList.toggle('hide-incoming', !filters.incoming);
el.classList.toggle('hide-system', !filters.system);
}

function renderFilterDropdown() {
const filters = getFilters();
const dd = $('filter-dropdown');
dd.innerHTML = FILTERS.map(f => {
  const active = filters[f.key];
  return `<div class="filter-item ${active ? 'active' : ''}" data-key="${f.key}">
    <span class="check">${active ? '✓' : ''}</span>
    ${f.label}
  </div>`;
}).join('');
}

$('logout-btn').addEventListener('click', () => {
localStorage.removeItem('kern_web_token');
location.reload();
});

$('filter-btn').addEventListener('click', (e) => {
e.stopPropagation();
const dd = $('filter-dropdown');
const isOpen = dd.classList.contains('open');
dd.classList.toggle('open', !isOpen);
if (!isOpen) renderFilterDropdown();
});

$('filter-dropdown').addEventListener('click', (e) => {
const item = e.target.closest('.filter-item');
if (!item) return;
e.stopPropagation();
const key = item.dataset.key;
const filters = getFilters();
filters[key] = !filters[key];
saveFilters(filters);
applyFilters();
renderFilterDropdown();
});

document.addEventListener('click', () => {
$('filter-dropdown').classList.remove('open');
});

applyFilters();

// Show token prompt using modal — resolves when user submits valid token
function showTokenPrompt() {
return new Promise(resolve => {
  const modal = $('auth-modal');
  const input = $('auth-token');
  const btn = $('auth-submit');
  input.value = '';
  modal.classList.add('open');
  input.focus();
  function submit() {
    const val = input.value.trim();
    if (!val) return;
    setLocalToken(val);
    modal.classList.remove('open');
    resolve(val);
  }
  btn.onclick = submit;
  input.onkeydown = (e) => { if (e.key === 'Enter') submit(); };
});
}

// On load: check URL for token param, save and clean URL
(function checkUrlToken() {
const params = new URLSearchParams(location.search);
const token = params.get('token');
if (token) {
  setLocalToken(token);
  history.replaceState(null, '', location.pathname);
}
})();

// On load: discover agents, auto-connect or show switcher
(async () => {
let localStatus = await discoverAllAgents();

// If local server needs auth, prompt for token
while (localStatus === 'unauthorized') {
  await showTokenPrompt();
  localStatus = await discoverAllAgents();
}

renderSwitcher();

const agents = getAllAgents();
const activeName = getActiveAgent();
const activeAgent = agents.find(a => a.name === activeName && a.running && a.url);
const runningAgents = agents.filter(a => a.running && a.url);

if (activeAgent) {
  // Resume previous agent
  BASE_URL = activeAgent.url;
  AUTH_TOKEN = getServerToken(activeAgent.server || location.origin);
  init();
  connectAllBackground();
} else if (runningAgents.length === 1) {
  // Only one running agent — auto-connect
  switchToAgent(runningAgents[0]);
  connectAllBackground();
} else if (runningAgents.length > 1) {
  // Multiple running agents — show switcher
  setConnected('disconnected');
  agentNameEl.textContent = 'kern';
  renderSwitcher();
  openSidebar();
  connectAllBackground();
} else {
  // No running agents
  setConnected('disconnected');
  agentNameEl.textContent = 'kern';
  addMessage('system', 'No running agents found. Start an agent with `kern start` or add a server.');
}
})();

// Register service worker for PWA
if ('serviceWorker' in navigator) {
navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// Bridge API for native clients (Android WebView)
// Stable contract — web UI internals can change without breaking the bridge.
window.KernBridge = {
connect: function(baseUrl, token, opts) { return AgentClient.connect(baseUrl, token, opts); },
send: function(text) {
  if (text !== undefined) {
    var input = document.getElementById('input');
    if (input) { input.value = text; input.dispatchEvent(new Event('input')); }
  }
  send();
},
handleEvent: function(ev) { return handleEvent(ev); },
setConnected: function(status) { setConnected(status); },
getState: function() {
  return {
    connectionId: connection ? connection.connectionId : null,
    streamingText: streamingText || '',
    busy: !!busy,
    connected: !!(connection && connection.connectionId)
  };
},
setConnectionId: function(id) { if (connection) connection.connectionId = id; },
setConnection: function(stub) { connection = stub; },
renderMarkdown: function(text) { return renderMarkdown(text); },
init: function() { init(); },
getBaseUrl: function() { return BASE_URL; },
setBaseUrl: function(url) { BASE_URL = url; },
switchAgent: function(index) {
  const agents = getAllAgents().filter(a => a.running && a.url);
  if (index >= 0 && index < agents.length) switchToAgent(agents[index]);
},
getAgents: function() {
  return getAllAgents().filter(a => a.running && a.url).map(a => a.name);
}
};
