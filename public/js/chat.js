(() => {
  const { getSessionId, toast, qs, validUsername, safeJsonParse } = window.ShadowUtil;

  const messagesEl = qs('#messages');
  const emptyStateEl = qs('#emptyState');
  const unreadMarkerEl = qs('#unreadMarker');
  const jumpLatestBtn = qs('#jumpLatestBtn');
  const pinBannerEl = qs('#pinBanner');
  const chatSearchEl = qs('#chatSearch');
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
  const roomCodeLg = qs('#roomCodeLg');
  const memberListEl = qs('#memberList');

  const reportModal = qs('#reportModal');
  const reportReasonInput = qs('#reportReasonInput');
  const reportSubmit = qs('#reportSubmit');
  const reportCancel = qs('#reportCancel');
  const reportChips = document.querySelectorAll('#reportChips .chip');

  const sessionId = getSessionId();
  const url = new URL(window.location.href);
  const teamCode = (url.searchParams.get('code') || sessionStorage.getItem('shadowteams_teamCode') || '').trim();
  const username = (sessionStorage.getItem('shadowteams_username') || localStorage.getItem('shadowteams_username') || '').trim();
  const passphrase = (url.searchParams.get('p') || sessionStorage.getItem('shadowteams_passphrase') || '').trim();
  const isOnion = location.hostname.endsWith('.onion');

  if (!teamCode || !/^[A-Za-z0-9]{6,10}$/.test(teamCode) || !validUsername(username)) {
    window.location.href = '/index.html';
    return;
  }

  meUserEl.textContent = username;
  teamCodePill.textContent = teamCode;
  if (roomCodeLg) roomCodeLg.textContent = teamCode;

  const localBad = ['fuck','shit','bitch','asshole','bastard','dick','pussy','cunt'];
  let ws = null;
  let reconnectTimer = null;
  let connectWatchdog = null;
  let reconnectAttempts = 0;
  let fallbackPollTimer = null;
  let fallbackPresenceTimer = null;
  let fallbackHeartbeatTimer = null;
  let fallbackEnabled = false;
  let typingTimer = null;
  let isTyping = false;
  let sendCooldownUntil = 0;
  let unseenCount = 0;
  let pendingReportId = null;
  let searchQuery = '';
  let lastSeenMaxId = 0;

  const renderedIds = new Set();
  const messageNodes = new Map();
  const typingUsers = new Map();

  function addTimeline(text) {
    const wrap = document.createElement('div');
    wrap.className = 'msg system';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    const content = document.createElement('div');
    content.className = 'content';
    content.textContent = text;
    bubble.appendChild(content);
    wrap.appendChild(bubble);
    messagesEl.appendChild(wrap);
    scrollToBottom();
  }

  function localFilter(text) {
    if (!profanityToggleEl.checked) return text;
    let out = text;
    for (const w of localBad) out = out.replace(new RegExp(`\\b${w}\\b`, 'gi'), '****');
    return out;
  }

  function setConnection(state) {
    connStatusEl.className = `status status-${state}`;
    connStatusEl.textContent = ({online:'Online',offline:'Reconnecting…',connecting:'Connecting…',fallback:'Fallback mode'})[state] || state;
    sendBtn.disabled = !(state === 'online' || state === 'fallback');
  }

  function formatTime(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  }

  function isNearBottom() { return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 80; }
  function scrollToBottom() { messagesEl.scrollTop = messagesEl.scrollHeight; }

  function setUnreadMarker(show, count = 0) {
    unreadMarkerEl.classList.toggle('hidden', !show);
    jumpLatestBtn.classList.toggle('hidden', !show);
    if (show) unreadMarkerEl.textContent = count > 1 ? `${count} new messages` : 'New message';
  }

  function updateOnlineText(n) {
    const num = Number(n || 0);
    onlineCountEl.textContent = String(num);
  }

  function renderMemberList(users = []) {
    if (!memberListEl) return;
    memberListEl.innerHTML = '';
    if (!users || !users.length) {
      memberListEl.innerHTML = '<li class="muted">No active members visible</li>';
      return;
    }
    for (const u of users) {
      const li = document.createElement('li');
      li.textContent = u + (u === username ? ' (you)' : '');
      memberListEl.appendChild(li);
    }
  }

  function updateEmptyState() {
    emptyStateEl.style.display = messagesEl.querySelector('.msg:not(.system)') ? 'none' : 'block';
  }

  function applyDeletedVisual(node) {
    if (!node) return;
    const content = node.querySelector('.content');
    if (content) {
      content.textContent = '[deleted]';
      content.style.opacity = '0.65';
      content.style.fontStyle = 'italic';
    }
    const delBtn = node.querySelector('.delete-own');
    if (delBtn) delBtn.remove();
  }

  function canDeleteMessage(msg) {
    if (!msg || msg.username !== username || !msg.id) return false;
    const age = Date.now() - new Date(msg.created_at).getTime();
    return Number.isFinite(age) && age <= 5 * 60 * 1000 && msg.content !== '[deleted]';
  }

  function highlightText(text) {
    const safe = String(text || '');
    if (!searchQuery) return safe;
    const q = searchQuery.toLowerCase();
    const idx = safe.toLowerCase().indexOf(q);
    if (idx < 0) return safe;
    const pre = safe.slice(0, idx);
    const hit = safe.slice(idx, idx + q.length);
    const post = safe.slice(idx + q.length);
    return `${pre}<mark>${hit}</mark>${post}`;
  }

  function applySearchFilter() {
    const msgs = messagesEl.querySelectorAll('.msg:not(.system)');
    msgs.forEach(node => {
      const raw = node.dataset.rawContent || '';
      const contentEl = node.querySelector('.content');
      if (contentEl && raw) contentEl.innerHTML = highlightText(raw);
      if (!searchQuery) {
        node.style.display = '';
      } else {
        node.style.display = raw.toLowerCase().includes(searchQuery.toLowerCase()) ? '' : 'none';
      }
    });
  }

  function openReportModal(messageId) {
    pendingReportId = messageId;
    reportReasonInput.value = '';
    reportChips.forEach(c => c.classList.remove('active'));
    reportModal.classList.remove('hidden');
    reportReasonInput.focus();
  }
  function closeReportModal() {
    pendingReportId = null;
    reportModal.classList.add('hidden');
  }

  reportChips.forEach(chip => chip.addEventListener('click', () => {
    reportChips.forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    reportReasonInput.value = chip.dataset.reason || '';
  }));

  reportCancel.onclick = closeReportModal;
  reportSubmit.onclick = async () => {
    if (!pendingReportId) return;
    const reason = (reportReasonInput.value || '').trim();
    if (reason.length < 2 || reason.length > 200) return toast(toastEl, 'Reason must be 2–200 chars');
    try {
      const r = await fetch('/api/report', { method:'POST', headers:{'Content-Type':'application/json','X-Session-Id':sessionId}, body: JSON.stringify({ messageId: pendingReportId, reason }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Report failed');
      toast(toastEl, 'Reported. Thank you.');
      closeReportModal();
    } catch (e) { toast(toastEl, e.message || 'Report failed'); }
  };

  async function deleteMessage(id) {
    if (fallbackEnabled) {
      const r = await fetch(`/api/message/${id}/delete`, { method:'POST', headers:{'Content-Type':'application/json','X-Session-Id':sessionId}, body:'{}' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Delete failed');
      applyDeletedVisual(messageNodes.get(id));
      return;
    }
    if (!sendJson({ type:'delete_message', id })) throw new Error('Not connected');
  }

  async function loadPin() {
    try {
      const r = await fetch(`/api/team/${encodeURIComponent(teamCode)}/pin`);
      const j = await r.json();
      if (!r.ok || !j.pin) {
        pinBannerEl.classList.add('hidden');
        pinBannerEl.textContent = '';
        return;
      }
      const m = j.pin.message;
      pinBannerEl.innerHTML = `📌 <strong>${m.username}</strong>: ${m.content} <button id="unpinBtn" class="icon-btn" style="margin-left:8px">Unpin</button>`;
      pinBannerEl.classList.remove('hidden');
      const unpin = qs('#unpinBtn');
      if (unpin) unpin.onclick = async () => {
        await fetch(`/api/team/${encodeURIComponent(teamCode)}/pin`, { method:'DELETE', headers:{'X-Session-Id':sessionId} });
        await loadPin();
      };
    } catch {}
  }

  async function pinMessage(id) {
    const r = await fetch(`/api/team/${encodeURIComponent(teamCode)}/pin`, {
      method:'POST', headers:{'Content-Type':'application/json','X-Session-Id':sessionId}, body: JSON.stringify({ messageId:id })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Pin failed');
    await loadPin();
  }

  function addMessage(msg) {
    const { id, username: u, content, created_at, deleted_at } = msg;
    if (id && renderedIds.has(id)) return;
    if (id) { renderedIds.add(id); if (Number(id)>lastSeenMaxId) lastSeenMaxId=Number(id); }

    const wrap = document.createElement('div');
    wrap.className = 'msg';
    if (id) wrap.dataset.id = String(id);
    wrap.dataset.rawContent = String(localFilter(content));

    const prev = messagesEl.querySelector('.msg:last-of-type');
    if (prev && prev.dataset.user === u) {
      const pt = Number(prev.dataset.ts || 0);
      const ct = new Date(created_at).getTime();
      if (Number.isFinite(pt) && Number.isFinite(ct) && (ct - pt) < 120000) wrap.classList.add('grouped');
    }
    wrap.dataset.user = u;
    wrap.dataset.ts = String(new Date(created_at).getTime());

    const bubble = document.createElement('div');
    bubble.className = 'bubble' + (u === username ? ' me' : '');

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.innerHTML = `<div class="user"></div><div class="time"></div>`;
    meta.querySelector('.user').textContent = u;
    meta.querySelector('.time').textContent = formatTime(created_at);

    const body = document.createElement('div');
    body.className = 'content';
    body.innerHTML = highlightText(localFilter(content));

    bubble.append(meta, body);

    const actions = document.createElement('div');
    actions.className = 'msg-actions';

    const copyBtn = document.createElement('button');
    copyBtn.className = 'icon-btn'; copyBtn.textContent = 'Copy';
    copyBtn.onclick = async () => { try { await navigator.clipboard.writeText(String(content || '')); toast(toastEl, 'Message copied'); } catch { toast(toastEl, 'Copy failed'); } };

    const pinBtn = document.createElement('button');
    pinBtn.className = 'icon-btn'; pinBtn.textContent = 'Pin';
    pinBtn.onclick = async () => { try { await pinMessage(id); toast(toastEl, 'Pinned'); } catch (e) { toast(toastEl, e.message || 'Pin failed'); } };

    const reportBtn = document.createElement('button');
    reportBtn.className = 'icon-btn'; reportBtn.textContent = 'Report';
    reportBtn.onclick = () => openReportModal(id);

    actions.append(copyBtn, pinBtn, reportBtn);

    if (canDeleteMessage(msg)) {
      const delBtn = document.createElement('button');
      delBtn.className = 'icon-btn delete-own';
      delBtn.textContent = 'Delete';
      delBtn.onclick = async () => { try { await deleteMessage(id); } catch (e) { toast(toastEl, e.message || 'Delete failed'); } };
      actions.appendChild(delBtn);
    }

    wrap.append(bubble, actions);

    const stick = isNearBottom();
    messagesEl.appendChild(wrap);
    if (id) messageNodes.set(id, wrap);
    if (deleted_at || content === '[deleted]') applyDeletedVisual(wrap);
    updateEmptyState();

    if (stick) { scrollToBottom(); unseenCount = 0; setUnreadMarker(false); }
    else { unseenCount += 1; setUnreadMarker(true, unseenCount); }
  }

  function onMessageDeleted(id) { applyDeletedVisual(messageNodes.get(Number(id))); }

  async function loadHistory() {
    try {
      const r = await fetch(`/api/team/${encodeURIComponent(teamCode)}/messages?limit=80`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Failed to load history');
      lastSeenMaxId = 0;
      messagesEl.innerHTML = '';
      renderedIds.clear(); messageNodes.clear();
      if (!j.messages.length) messagesEl.appendChild(emptyStateEl);
      for (const m of j.messages) addMessage(m);
      updateEmptyState();
      scrollToBottom();
      unseenCount = 0; setUnreadMarker(false);
    } catch (e) { toast(toastEl, e.message || 'Failed to load history'); }
  }

  function updateTypingLine() {
    const now = Date.now();
    for (const [u,t] of typingUsers.entries()) if (now - t > 2200) typingUsers.delete(u);
    const others = [...typingUsers.keys()].filter(u => u !== username);
    typingEl.textContent = others.length === 0 ? '' : (others.length === 1 ? `${others[0]} is typing…` : `${others.slice(0,2).join(', ')} are typing…`);
  }


  async function sendFallbackHeartbeat() {
    try {
      await fetch(`/api/team/${encodeURIComponent(teamCode)}/heartbeat`, {
        method:'POST',
        headers:{'Content-Type':'application/json','X-Session-Id':sessionId},
        body: JSON.stringify({ username })
      });
    } catch {}
  }

  async function pollFallbackPresence() {
    try {
      const r = await fetch(`/api/team/${encodeURIComponent(teamCode)}/presence`, { cache:'no-store' });
      const j = await r.json();
      if (!r.ok) return;
      updateOnlineText(j.onlineCount ?? 1);
      renderMemberList(j.onlineUsers || [username]);
    } catch {
      renderMemberList([username]);
    }
  }

  async function pollFallback() {
    try {
      const r = await fetch(`/api/team/${encodeURIComponent(teamCode)}/messages?limit=80`, { cache:'no-store' });
      const j = await r.json(); if (!r.ok) return;
      let added = 0;
      for (const m of j.messages) { if (!m.id || Number(m.id) > lastSeenMaxId || !renderedIds.has(m.id)) { addMessage(m); added++; } }
      if (added===0) return;
      // message sync only; presence handled separately
    } catch {}
  }

  function enableFallbackMode() {
    if (fallbackEnabled) return;
    fallbackEnabled = true; setConnection('fallback');
    addTimeline('Switched to fallback mode');
    pollFallback();
    pollFallbackPresence();
    sendFallbackHeartbeat();
    fallbackPollTimer = setInterval(pollFallback, 2500);
    fallbackPresenceTimer = setInterval(pollFallbackPresence, 4000);
    fallbackHeartbeatTimer = setInterval(sendFallbackHeartbeat, 15000);
  }

  async function diagnoseConnectivity() {
    try { const r = await fetch('/health', { cache:'no-store' }); if (r.ok) enableFallbackMode(); else toast(toastEl, 'Server not reachable right now.'); }
    catch { toast(toastEl, 'Network issue: cannot reach server.'); }
  }

  function wsUrl() { return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`; }
  function sendJson(obj) { if (!ws || ws.readyState !== WebSocket.OPEN) return false; ws.send(JSON.stringify(obj)); return true; }

  function connect() {
    if (fallbackEnabled) return;
    if (isOnion) {
      enableFallbackMode();
      return;
    }
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (connectWatchdog) clearTimeout(connectWatchdog);
    setConnection('connecting');

    ws = new WebSocket(wsUrl());

    connectWatchdog = setTimeout(() => {
      if (!ws || ws.readyState !== WebSocket.OPEN) { setConnection('offline'); diagnoseConnectivity(); }
    }, 8000);

    ws.onopen = () => {
      reconnectAttempts = 0;
      if (connectWatchdog) clearTimeout(connectWatchdog);
      sendJson({ type:'join', teamCode, username, sessionId, passphrase });
    };

    ws.onmessage = (ev) => {
      const data = safeJsonParse(ev.data); if (!data || !data.type) return;
      if (data.type === 'joined') {
        setConnection('online');
        teamNameEl.textContent = data.team?.name || 'Team';
        updateOnlineText(data.onlineCount ?? 0);
        renderMemberList(data.onlineUsers || []);
        addTimeline('Connected');
        const privacyBadge = qs('#privacyBadge');
        if (privacyBadge) privacyBadge.textContent = data.team?.protected ? 'Privacy mode: passphrase-protected room' : 'Privacy mode: open room';
        return;
      }
      if (data.type === 'presence') { updateOnlineText(data.onlineCount ?? 0); renderMemberList(data.onlineUsers || []); return; }
      if (data.type === 'message') return addMessage(data);
      if (data.type === 'message_deleted') return onMessageDeleted(data.id);
      if (data.type === 'typing') {
        if (!data.username) return;
        if (data.isTyping) typingUsers.set(data.username, Date.now()); else typingUsers.delete(data.username);
        return updateTypingLine();
      }
      if (data.type === 'rate_limited') return toast(toastEl, data.error || 'Slow down a bit.');
      if (data.type === 'team_missing') { toast(toastEl, 'Team no longer exists. Returning…', 1500); return setTimeout(() => (window.location.href='/index.html'), 900); }
      if (data.type === 'error') return toast(toastEl, data.error || 'Error');
    };

    ws.onclose = () => {
      if (connectWatchdog) clearTimeout(connectWatchdog);
      if (fallbackEnabled) return;
      setConnection('offline');
      reconnectAttempts += 1;
      addTimeline('Disconnected, retrying…');
      reconnectTimer = setTimeout(connect, Math.min(6000, 1200 + reconnectAttempts * 600));
      if (reconnectAttempts >= 2) diagnoseConnectivity();
    };
  }

  async function sendMessageHttpFallback(text) {
    const r = await fetch(`/api/team/${encodeURIComponent(teamCode)}/messages`, {
      method:'POST', headers:{'Content-Type':'application/json','X-Session-Id':sessionId}, body: JSON.stringify({ username, content:text })
    });
    const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Failed to send');
    if (j.message) addMessage(j.message);
  }

  async function sendMessage() {
    if (Date.now() < sendCooldownUntil) return;
    const text = (inputEl.value || '').trim();
    if (!text) return;
    if (text.length > 500) return toast(toastEl, 'Message too long (max 500)');

    try {
      if (fallbackEnabled) await sendMessageHttpFallback(text);
      else if (!sendJson({ type:'message', content:text })) return toast(toastEl, 'Not connected yet. Try again in a second.');

      inputEl.value = '';
      updateCharCount();
      setTyping(false);
      sendCooldownUntil = Date.now() + 900;
      sendBtn.disabled = true;
      setTimeout(() => { if (connStatusEl.textContent !== 'Connecting…') sendBtn.disabled = !(connStatusEl.textContent === 'Online' || connStatusEl.textContent === 'Fallback mode'); }, 900);
    } catch (e) { toast(toastEl, e.message || 'Failed to send'); }
  }

  function updateCharCount() { charCountEl.textContent = `${(inputEl.value || '').length}/500`; }

  function setTyping(v) {
    if (fallbackEnabled) return;
    if (isTyping === v) return;
    isTyping = v;
    sendJson({ type:'typing', isTyping:v });
  }

  sendBtn.onclick = sendMessage;
  inputEl.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } };
  inputEl.oninput = () => {
    updateCharCount();
    const has = (inputEl.value || '').trim().length > 0;
    setTyping(has);
    if (typingTimer) clearTimeout(typingTimer);
    typingTimer = setTimeout(() => setTyping(false), 1500);
  };

  messagesEl.onscroll = () => { if (isNearBottom()) { unseenCount = 0; setUnreadMarker(false); } };
  jumpLatestBtn.onclick = () => { scrollToBottom(); unseenCount = 0; setUnreadMarker(false); };
  profanityToggleEl.onchange = () => loadHistory();

  chatSearchEl.oninput = () => { searchQuery = (chatSearchEl.value || '').trim(); applySearchFilter(); };
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      chatSearchEl.focus();
      chatSearchEl.select();
    }
  });

  copyInviteBtn.onclick = async () => {
    const invite = `${location.origin}/chat.html?code=${encodeURIComponent(teamCode)}`;
    const text = `Join my ShadowTeams room: ${invite}`;
    try { await navigator.clipboard.writeText(text); toast(toastEl, 'Invite text copied'); }
    catch { toast(toastEl, text, 5000); }
  };

  copyCodeBtn.onclick = async () => {
    try { await navigator.clipboard.writeText(teamCode); toast(toastEl, 'Team code copied'); }
    catch { toast(toastEl, `Team code: ${teamCode}`); }
  };

  leaveBtn.onclick = () => {
    try { if (ws) ws.close(); } catch {}
    if (fallbackPollTimer) clearInterval(fallbackPollTimer);
    if (fallbackPresenceTimer) clearInterval(fallbackPresenceTimer);
    if (fallbackHeartbeatTimer) clearInterval(fallbackHeartbeatTimer);
    sessionStorage.removeItem('shadowteams_teamCode');
    sessionStorage.removeItem('shadowteams_passphrase');
    window.location.href = '/index.html';
  };

  updateCharCount();
  setConnection('connecting');
  loadHistory().then(async () => {
    await loadPin();
    if (isOnion) addTimeline('Onion mode: fallback-first for reliability');
    connect();
  });
})();
