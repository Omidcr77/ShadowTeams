// public/js/chat.js
(() => {
  const { getSessionId, toast, qs, validUsername, safeJsonParse } = window.ShadowUtil;

  const messagesEl = qs('#messages');
  const inputEl = qs('#input');
  const sendBtn = qs('#sendBtn');
  const leaveBtn = qs('#leaveBtn');
  const teamCodePill = qs('#teamCodePill');
  const teamNameEl = qs('#teamName');
  const meUserEl = qs('#meUser');
  const onlineCountEl = qs('#onlineCount');
  const typingEl = qs('#typing');
  const profanityToggleEl = qs('#profanityToggle');
  const toastEl = qs('#toast');

  const sessionId = getSessionId();

  const url = new URL(window.location.href);
  const teamCode = (url.searchParams.get('code') || sessionStorage.getItem('shadowteams_teamCode') || '').trim();
  const username = (sessionStorage.getItem('shadowteams_username') || localStorage.getItem('shadowteams_username') || '').trim();

  if (!teamCode || !/^[A-Za-z0-9]{6,10}$/.test(teamCode) || !validUsername(username)) {
    window.location.href = '/index.html';
    return;
  }

  meUserEl.textContent = username;
  teamCodePill.textContent = teamCode;

  // local profanity filter (client-side optional)
  const localBad = ['fuck','shit','bitch','asshole','bastard','dick','pussy','cunt'];
  function localFilter(text) {
    if (!profanityToggleEl.checked) return text;
    let out = text;
    for (const w of localBad) {
      const re = new RegExp(`\\b${w}\\b`, 'gi');
      out = out.replace(re, '****');
    }
    return out;
  }

  function formatTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function addMessage({ id, username: u, content, created_at }) {
    const wrap = document.createElement('div');
    wrap.className = 'msg';

    const bubble = document.createElement('div');
    bubble.className = 'bubble' + (u === username ? ' me' : '');

    const meta = document.createElement('div');
    meta.className = 'meta';

    const user = document.createElement('div');
    user.className = 'user';
    user.textContent = u;

    const time = document.createElement('div');
    time.className = 'time';
    time.textContent = formatTime(created_at);

    meta.appendChild(user);
    meta.appendChild(time);

    const body = document.createElement('div');
    body.className = 'content';
    body.textContent = localFilter(content);

    bubble.appendChild(meta);
    bubble.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'msg-actions';

    const reportBtn = document.createElement('button');
    reportBtn.className = 'icon-btn';
    reportBtn.title = 'Report message';
    reportBtn.textContent = 'Report';
    reportBtn.addEventListener('click', async () => {
      const reason = prompt('Report reason (2–200 chars):', 'Abuse / spam');
      if (!reason) return;
      try {
        const r = await fetch('/api/report', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Session-Id': sessionId
          },
          body: JSON.stringify({ messageId: id, reason })
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'Report failed');
        toast(toastEl, 'Reported. Thank you.');
      } catch (e) {
        toast(toastEl, e.message || 'Report failed');
      }
    });

    actions.appendChild(reportBtn);
    wrap.appendChild(bubble);
    wrap.appendChild(actions);

    messagesEl.appendChild(wrap);
  }

  async function loadHistory() {
    try {
      const r = await fetch(`/api/team/${encodeURIComponent(teamCode)}/messages?limit=50`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Failed to load history');
      messagesEl.innerHTML = '';
      for (const m of j.messages) addMessage(m);
      scrollToBottom();
    } catch (e) {
      toast(toastEl, e.message || 'Failed to load history');
    }
  }

  let ws = null;
  let reconnectTimer = null;
  let typingTimer = null;
  let isTyping = false;
  const typingUsers = new Map(); // username -> lastSeenMs

  function updateTypingLine() {
    const now = Date.now();
    // remove stale (2s)
    for (const [u, t] of typingUsers.entries()) {
      if (now - t > 2200) typingUsers.delete(u);
    }
    const others = [...typingUsers.keys()].filter(u => u !== username);
    if (others.length === 0) {
      typingEl.textContent = '';
      return;
    }
    typingEl.textContent = others.length === 1 ? `${others[0]} is typing…` : `${others.slice(0,2).join(', ')} are typing…`;
  }

  function wsUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws`;
  }

  function sendJson(obj) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(obj));
  }

  function connect() {
    if (reconnectTimer) window.clearTimeout(reconnectTimer);

    ws = new WebSocket(wsUrl());

    ws.addEventListener('open', () => {
      sendJson({ type: 'join', teamCode, username, sessionId });
    });

    ws.addEventListener('message', (ev) => {
      const data = safeJsonParse(ev.data);
      if (!data || !data.type) return;

      if (data.type === 'joined') {
        teamNameEl.textContent = data.team?.name || 'Team';
        onlineCountEl.textContent = String(data.onlineCount ?? 0);
        toast(toastEl, 'Connected');
        return;
      }

      if (data.type === 'presence') {
        onlineCountEl.textContent = String(data.onlineCount ?? 0);
        return;
      }

      if (data.type === 'message') {
        addMessage(data);
        scrollToBottom();
        return;
      }

      if (data.type === 'typing') {
        if (!data.username) return;
        if (data.isTyping) typingUsers.set(data.username, Date.now());
        else typingUsers.delete(data.username);
        updateTypingLine();
        return;
      }

      if (data.type === 'rate_limited') {
        toast(toastEl, data.error || 'Rate limited');
        return;
      }

      if (data.type === 'team_missing') {
        toast(toastEl, 'Team no longer exists. Returning…', 1500);
        setTimeout(() => window.location.href = '/index.html', 900);
        return;
      }

      if (data.type === 'error') {
        toast(toastEl, data.error || 'Error');
        return;
      }
    });

    ws.addEventListener('close', () => {
      toast(toastEl, 'Disconnected. Reconnecting…', 1400);
      reconnectTimer = window.setTimeout(connect, 900);
    });

    ws.addEventListener('error', () => {
      // noop; close event triggers reconnect
    });
  }

  // Send message
  function sendMessage() {
    const text = (inputEl.value || '').trim();
    if (!text) return;
    if (text.length > 500) {
      toast(toastEl, 'Message too long (max 500)');
      return;
    }
    sendJson({ type: 'message', content: text });
    inputEl.value = '';
    setTyping(false);
  }

  sendBtn.addEventListener('click', sendMessage);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  function setTyping(v) {
    if (isTyping === v) return;
    isTyping = v;
    sendJson({ type: 'typing', isTyping: v });
  }

  inputEl.addEventListener('input', () => {
    const has = (inputEl.value || '').trim().length > 0;
    setTyping(has);
    if (typingTimer) window.clearTimeout(typingTimer);
    typingTimer = window.setTimeout(() => setTyping(false), 1500);
  });

  profanityToggleEl.addEventListener('change', () => {
    // Re-render by reloading history (simple)
    loadHistory();
  });

  leaveBtn.addEventListener('click', () => {
    try { if (ws) ws.close(); } catch {}
    sessionStorage.removeItem('shadowteams_teamCode');
    window.location.href = '/index.html';
  });

  // boot
  loadHistory().then(connect);
})();
