// ==========================================================================
// Agent Client Protocol
// ==========================================================================
// Pure data layer — no DOM, no rendering. Portable to any client.

const AgentClient = {
/**
 * Connect to agent SSE event stream.
 * @param {string} baseUrl - Agent HTTP base URL
 * @param {string} [token] - Auth token
 * @param {function} onEvent - Called with each ServerEvent
 * @param {function} onConnect - Called when stream connects
 * @param {function} onDisconnect - Called when stream disconnects
 * @returns {{ close: function }} - Call close() to disconnect
 */
connect(baseUrl, token, { onEvent, onConnect, onDisconnect }) {
  // Close any existing EventSource to prevent duplicates
  if (activeEventSource) {
    activeEventSource.close();
    activeEventSource = null;
  }
  // EventSource can't set headers — pass token as query param
  const url = token ? `${baseUrl}/events?token=${encodeURIComponent(token)}` : `${baseUrl}/events`;
  const es = new EventSource(url);
  activeEventSource = es;
  let connected = false;
  es.onopen = () => { connected = true; onConnect?.(); };
  let connectionId = null;
  es.onmessage = (e) => {
    try {
      const ev = JSON.parse(e.data);
      if (ev.type === 'connection' && ev.connectionId) {
        connectionId = ev.connectionId;
        return; // don't pass connection event to handler
      }
      onEvent(ev);
    } catch {}
  };
  es.onerror = () => {
    es.close();
    if (connected) {
      connected = false;
      onDisconnect?.();
    } else {
      // Never connected — likely auth failure or server down
      onDisconnect?.();
    }
  };
  return {
    close() { es.close(); onDisconnect?.(); },
    get connectionId() { return connectionId; }
  };
},

/**
 * Build headers for authenticated requests.
 * @param {string} [token]
 * @returns {object}
 */
_headers(token) {
  const h = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
},

/**
 * Send a message to the agent.
 * @param {string} baseUrl
 * @param {string} [token]
 * @param {string} text
 * @param {object} [opts] - userId, interface, channel
 * @returns {Promise<{ok: boolean}>}
 */
async sendMessage(baseUrl, token, text, opts = {}) {
  const payload = {
    text,
    userId: opts.userId || 'tui',
    interface: opts.interface || 'web',
    channel: opts.channel || 'web',
    connectionId: opts.connectionId,
  };
  // Attach base64-encoded files if present
  if (opts.attachments && opts.attachments.length > 0) {
    payload.attachments = opts.attachments;
  }
  const res = await fetch(`${baseUrl}/message`, {
    method: 'POST',
    headers: this._headers(token),
    body: JSON.stringify(payload),
  });
  return res.json();
},

/**
 * Get agent status.
 * @param {string} baseUrl
 * @param {string} [token]
 * @returns {Promise<object>}
 */
async getStatus(baseUrl, token) {
  const res = await fetch(`${baseUrl}/status`, { headers: this._headers(token) });
  return res.json();
},

/**
 * Get message history.
 * @param {string} baseUrl
 * @param {string} [token]
 * @param {number} [limit=50]
 * @param {number} [before] - Index to paginate from
 * @returns {Promise<Array>}
 */
async getHistory(baseUrl, token, limit = 50, before) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (before !== undefined) params.set('before', String(before));
  const res = await fetch(`${baseUrl}/history?${params}`, { headers: this._headers(token) });
  return res.json();
},

async getSystemPrompt(baseUrl, token) {
  const res = await fetch(`${baseUrl}/context/system`, { headers: this._headers(token) });
  return res.text();
},

async getContextSegments(baseUrl, token) {
  const res = await fetch(`${baseUrl}/context/segments`, { headers: this._headers(token) });
  return res.json();
},

async getSummaries(baseUrl, token) {
  const res = await fetch(`${baseUrl}/summaries`, { headers: this._headers(token) });
  return res.json();
},

async regenerateSummary(baseUrl, token) {
  const res = await fetch(`${baseUrl}/summaries/regenerate`, {
    method: 'POST',
    headers: this._headers(token),
  });
  return res.json();
},

async recallSearch(baseUrl, token, query, limit = 10) {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  const res = await fetch(`${baseUrl}/recall/search?${params}`, { headers: this._headers(token) });
  return res.json();
},

async getRecallStats(baseUrl, token) {
  const res = await fetch(`${baseUrl}/recall/stats`, { headers: this._headers(token) });
  return res.json();
},

async getSessions(baseUrl, token) {
  const res = await fetch(`${baseUrl}/sessions`, { headers: this._headers(token) });
  return res.json();
},

async getSessionActivity(baseUrl, token, sessionId) {
  const res = await fetch(`${baseUrl}/sessions/${sessionId}/activity`, { headers: this._headers(token) });
  return res.json();
},
};

