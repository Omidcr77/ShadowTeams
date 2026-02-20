(() => {
  const { getSessionId, toast, qs, validUsername, safeJsonParse } = window.ShadowUtil;

  const messagesEl = qs('#messages');
  const emptyStateEl = qs('#emptyState');
  const unreadMarkerEl = qs('#unreadMarker');
  const inputEl = qs('#input');
  const sendBtn = qs('#sendBtn');
  const leaveBtn = qs('#leaveBtn');
  const copyCodeBtn = qs('#copyCodeBtn');
  const copyInviteBtn = qs('#copyInviteBtn');
  const charCountEl = qs('#charCount');
  const connStatusEl = qs('#connStatus');
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
  const roomHintEl = qs('#roomHint');
  if (roomHintEl) roomHintEl.textContent = `Room code: ${teamCode} (must match on both screens)`;

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

  function setConnection(state) {
    connStatusEl.className = `status status-${state}`;
    if (state === 'online') connStatusEl.textContent = 'Online';
    if (state === 'offline') connStatusEl.textContent = 'Reconnecting…';
    if (state === 'connecting') connStatusEl.textContent = 'Connecting…';
    if (state === 'fallback') connStatusEl.textContent = 'Fallback mode';
    sendBtn.disabled = !(state === 'online' || state === 'fallback');
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

  const renderedIds = new Set();
  let unseenCount = 0;
  function updateEmptyState() {
    if (!emptyStateEl) return;
    emptyStateEl.style.display = messagesEl.querySelector('.msg') ? 'none' : 'block';
  }


  function isNearBottom() {
    const threshold = 80;
    return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < threshold;
  }

  function setUnreadMarker(show, count = 0) {
    if (!unreadMarkerEl) return;
    unreadMarkerEl.classList.toggle('hidden', !show);
    if (show) unreadMarkerEl.textContent = count > 1 ? `${count} new messages` : 'New message';
  }

  function addMessage({ id, username: u, content, created_at }) {
    if (id && renderedIds.has(id)) return;
    if (id) renderedIds.add(id);

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

    const copyBtn = document.createElement('button');
    copyBtn.className = 'icon-btn';
    copyBtn.title = 'Copy message';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(String(content || ''));
        toast(toastEl, 'Message copied');
      } catch {
        toast(toastEl, 'Copy failed');
      }
    });

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

    actions.appendChild(copyBtn);
    actions.appendChild(reportBtn);
    wrap.appendChild(bubble);
    wrap.appendChild(actions);

    const shouldStick = isNearBottom();
    messagesEl.appendChild(wrap);
    updateEmptyState();
    if (shouldStick) {
      scrollToBottom();
      unseenCount = 0;
      setUnreadMarker(false);
    } else {
      unseenCount += 1;
      setUnreadMarker(true, unseenCount);
    }
  }

  async function loadHistory() {
    try {
      const r = await fetch(`/api/team/${encodeURIComponent(teamCode)}/messages?limit=50`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Failed to load history');
      messagesEl.innerHTML = '';
      renderedIds.clear();
      if (!j.messages.length) messagesEl.appendChild(emptyStateEl);
      for (const m of j.messages) addMessage(m);
      updateEmptyState();
      scrollToBottom();
      unseenCount = 0;
      setUnreadMarker(false);
    } catch (e) {
      toast(toastEl, e.message || 'Failed to load history');
    }
  }

  let ws = null;
  let reconnectTimer = null;
  let connectWatchdog = null;
  let reconnectAttempts = 0;
  let fallbackPollTimer = null;
  let fallbackEnabled = false;
  let typingTimer = null;
  let isTyping = false;
  const typingUsers = new Map();

  function updateTypingLine() {
    const now = Date.now();
    for (const [u, t] of typingUsers.entries()) {
      if (now - t > 2200) typingUsers.delete(u);
    }
    const others = [...typingUsers.keys()].filter(u => u !== username);
    typingEl.textContent = others.length === 0 ? '' : (others.length === 1 ? `${others[0]} is typing…` : `${others.slice(0,2).join(', ')} are typing…`);
  }

  async function pollFallback() {
    try {
      const r = await fetch(`/api/team/${encodeURIComponent(teamCode)}/messages?limit=50`, { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) return;
      const before = renderedIds.size;
      for (const m of j.messages) addMessage(m);
      if (renderedIds.size > before) scrollToBottom();
      onlineCountEl.textContent = '1+';
    } catch {}
  }

  function enableFallbackMode() {
    if (fallbackEnabled) return;
    fallbackEnabled = true;
    setConnection('fallback');
    toast(toastEl, 'Realtime blocked. Switched to fallback mode.', 3000);
    pollFallback();
    fallbackPollTimer = window.setInterval(pollFallback, 2500);
  }

  async function diagnoseConnectivity() {
    try {
      const r = await fetch('/health', { cache: 'no-store' });
      if (r.ok) {
        enableFallbackMode();
      } else {
        toast(toastEl, 'Server not reachable right now.');
      }
    } catch {
      toast(toastEl, 'Network issue: cannot reach server.');
    }
  }

  function wsUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws`;
  }

  function sendJson(obj) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(obj));
    return true;
  }

  function connect() {
    if (fallbackEnabled) return;
    if (reconnectTimer) window.clearTimeout(reconnectTimer);
    if (connectWatchdog) window.clearTimeout(connectWatchdog);
    setConnection('connecting');

    ws = new WebSocket(wsUrl());

    connectWatchdog = window.setTimeout(() => {
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        setConnection('offline');
        diagnoseConnectivity();
      }
    }, 8000);

    ws.addEventListener('open', () => {
      reconnectAttempts = 0;
      if (connectWatchdog) window.clearTimeout(connectWatchdog);
      sendJson({ type: 'join', teamCode, username, sessionId });
    });

    ws.addEventListener('message', (ev) => {
      const data = safeJsonParse(ev.data);
      if (!data || !data.type) return;

      if (data.type === 'joined') {
        setConnection('online');
        teamNameEl.textContent = data.team?.name || 'Team';
        onlineCountEl.textContent = String(data.onlineCount ?? 0);
        return;
      }

      if (data.type === 'presence') {
        onlineCountEl.textContent = String(data.onlineCount ?? 0);
        return;
      }

      if (data.type === 'message') {
        addMessage(data);
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
        toast(toastEl, data.error || 'Slow down a bit.');
        return;
      }

      if (data.type === 'team_missing') {
        toast(toastEl, 'Team no longer exists. Returning…', 1500);
        setTimeout(() => window.location.href = '/index.html', 900);
        return;
      }

      if (data.type === 'error') {
        toast(toastEl, data.error || 'Error');
      }
    });

    ws.addEventListener('close', () => {
      if (connectWatchdog) window.clearTimeout(connectWatchdog);
      if (fallbackEnabled) return;
      setConnection('offline');
      reconnectAttempts += 1;
      const delay = Math.min(6000, 1200 + reconnectAttempts * 600);
      reconnectTimer = window.setTimeout(connect, delay);
      if (reconnectAttempts >= 2) diagnoseConnectivity();
    });

    ws.addEventListener('error', () => {
      // close handles reconnect/fallback
    });
  }

  async function sendMessageHttpFallback(text) {
    const r = await fetch(`/api/team/${encodeURIComponent(teamCode)}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': sessionId
      },
      body: JSON.stringify({ username, content: text })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Failed to send');
    if (j.message) addMessage(j.message);
  }

  async function sendMessage() {
    const text = (inputEl.value || '').trim();
    if (!text) return;
    if (text.length > 500) {
      toast(toastEl, 'Message too long (max 500)');
      return;
    }

    try {
      if (fallbackEnabled) {
        await sendMessageHttpFallback(text);
      } else {
        if (!sendJson({ type: 'message', content: text })) {
          toast(toastEl, 'Not connected yet. Try again in a second.');
          return;
        }
      }
      inputEl.value = '';
      updateCharCount();
      setTyping(false);
    } catch (e) {
      toast(toastEl, e.message || 'Failed to send');
    }
  }

  function updateCharCount() {
    const n = (inputEl.value || '').length;
    charCountEl.textContent = `${n}/500`;
  }

  sendBtn.addEventListener('click', sendMessage);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  function setTyping(v) {
    if (fallbackEnabled) return;
    if (isTyping === v) return;
    isTyping = v;
    sendJson({ type: 'typing', isTyping: v });
  }

  inputEl.addEventListener('input', () => {
    updateCharCount();
    const has = (inputEl.value || '').trim().length > 0;
    setTyping(has);
    if (typingTimer) window.clearTimeout(typingTimer);
    typingTimer = window.setTimeout(() => setTyping(false), 1500);
  });


  messagesEl.addEventListener('scroll', () => {
    if (isNearBottom()) {
      unseenCount = 0;
      setUnreadMarker(false);
    }
  });

  profanityToggleEl.addEventListener('change', () => {
    loadHistory();
  });


  copyInviteBtn.addEventListener('click', async () => {
    const invite = `${location.origin}/chat.html?code=${encodeURIComponent(teamCode)}`;
    try {
      await navigator.clipboard.writeText(invite);
      toast(toastEl, 'Invite link copied');
    } catch {
      toast(toastEl, invite, 4000);
    }
  });
  copyCodeBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(teamCode);
      toast(toastEl, 'Team code copied');
    } catch {
      toast(toastEl, `Team code: ${teamCode}`);
    }
  });

  leaveBtn.addEventListener('click', () => {
    try { if (ws) ws.close(); } catch {}
    if (fallbackPollTimer) window.clearInterval(fallbackPollTimer);
    sessionStorage.removeItem('shadowteams_teamCode');
    window.location.href = '/index.html';
  });

  updateCharCount();
  setConnection('connecting');
  loadHistory().then(connect);
})();
