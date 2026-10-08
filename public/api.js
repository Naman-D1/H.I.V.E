// Thin fetch wrapper around the H.I.V.E. API. Keeps the JWT in localStorage.
const Api = {
  get token() {
    return localStorage.getItem('hive_token');
  },
  set token(value) {
    if (value) localStorage.setItem('hive_token', value);
    else localStorage.removeItem('hive_token');
  },

  async request(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    const res = await fetch(path, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    let data = null;
    try { data = await res.json(); } catch (_) { /* no body */ }

    if (!res.ok) {
      const error = new Error((data && data.error) || `Request failed (${res.status})`);
      error.status = res.status;
      throw error;
    }
    return data;
  },

  get(path) { return this.request('GET', path); },
  post(path, body) { return this.request('POST', path, body); },
  patch(path, body) { return this.request('PATCH', path, body); },
};

// ---- Small shared helpers ----

// Escape text before putting it into innerHTML (names/messages are user-supplied).
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// SQLite's datetime('now') is UTC but has no timezone marker ("2026-10-06 04:50:00"),
// so a plain new Date() would read it as LOCAL time and be off by the UTC offset (e.g. "5h ago" in IST).
function parseUtc(s) {
  if (!s) return null;
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) return new Date(s);
  return new Date(String(s).replace(' ', 'T') + 'Z');
}

function timeAgo(iso) {
  const diffMs = Date.now() - parseUtc(iso).getTime();
  const mins = Math.max(0, Math.floor(diffMs / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatDate(iso) {
  const d = parseUtc(iso);
  return d ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
}

// Called when a page fails to load its data. Only a rejected login (401) should send the user back
// to the sign-in page; any other failure (server down, old server code, 500) is shown on the page
// so it can actually be diagnosed instead of silently bouncing to the login screen.
function handleInitError(err) {
  if (err && err.status === 401) {
    Api.token = null;
    window.location.href = 'index.html';
    return;
  }
  console.error(err);
  const main = document.querySelector('main') || document.body;
  const box = document.createElement('div');
  box.className = 'msg error';
  box.style.margin = '16px 0';
  box.textContent = `Couldn't load this page: ${err && err.message ? err.message : err}. ` +
    'If you just updated the code, restart the server (npm start) and hard-refresh the browser (Ctrl+F5).';
  main.prepend(box);
}
