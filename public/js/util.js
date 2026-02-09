// public/js/util.js
(function () {
  // UUID v4 (browser-safe)
  function uuidv4() {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    a[6] = (a[6] & 0x0f) | 0x40;
    a[8] = (a[8] & 0x3f) | 0x80;
    const hex = [...a].map(b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  }

  function getSessionId() {
    const key = 'shadowteams_sessionId';
    let sid = localStorage.getItem(key);
    if (!sid) {
      sid = uuidv4();
      localStorage.setItem(key, sid);
    }
    return sid;
  }

  function toast(el, msg, ms = 2200) {
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
    window.clearTimeout(el._t);
    el._t = window.setTimeout(() => el.classList.add('hidden'), ms);
  }

  function qs(sel) { return document.querySelector(sel); }

  function validUsername(u) {
    return typeof u === 'string' && u.length >= 3 && u.length <= 20 && /^[A-Za-z0-9_]+$/.test(u);
  }

  function safeJsonParse(x) {
    try { return JSON.parse(x); } catch { return null; }
  }

  window.ShadowUtil = { getSessionId, toast, qs, validUsername, safeJsonParse };
})();
