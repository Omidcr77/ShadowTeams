// public/js/app.js
(() => {
  const { getSessionId, toast, qs, validUsername } = window.ShadowUtil;

  const usernameEl = qs('#username');
  const teamNameEl = qs('#teamName');
  const teamDescEl = qs('#teamDesc');
  const teamCodeEl = qs('#teamCode');

  const btnRandom = qs('#btnRandom');
  const btnCreate = qs('#btnCreate');
  const btnJoin = qs('#btnJoin');
  const toastEl = qs('#toast');

  // Ensure sessionId exists (privacy: local only)
  getSessionId();

  // Restore cached username
  const cachedUser = localStorage.getItem('shadowteams_username');
  if (cachedUser) usernameEl.value = cachedUser;

  function setUser(username) {
    localStorage.setItem('shadowteams_username', username);
  }

  function goChat(teamCode) {
    const username = usernameEl.value.trim();
    setUser(username);
    sessionStorage.setItem('shadowteams_teamCode', teamCode);
    sessionStorage.setItem('shadowteams_username', username);
    window.location.href = `/chat.html?code=${encodeURIComponent(teamCode)}`;
  }

  function requireUser() {
    const u = usernameEl.value.trim();
    if (!validUsername(u)) {
      toast(toastEl, 'Invalid username: 3–20 chars, letters/numbers/_');
      usernameEl.focus();
      return null;
    }
    return u;
  }

  btnRandom.addEventListener('click', async () => {
    const username = requireUser();
    if (!username) return;

    btnRandom.disabled = true;
    try {
      const r = await fetch('/api/team/random', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Failed');
      goChat(j.team.code);
    } catch (e) {
      toast(toastEl, e.message || 'Failed to join random team');
    } finally {
      btnRandom.disabled = false;
    }
  });

  btnCreate.addEventListener('click', async () => {
    const username = requireUser();
    if (!username) return;

    const teamName = (teamNameEl.value || '').trim();
    const description = (teamDescEl.value || '').trim();
    if (teamName.length < 2 || teamName.length > 40) {
      toast(toastEl, 'Team name must be 2–40 chars');
      teamNameEl.focus();
      return;
    }

    btnCreate.disabled = true;
    try {
      const r = await fetch('/api/team/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, teamName, description })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Failed');
      goChat(j.teamCode);
    } catch (e) {
      toast(toastEl, e.message || 'Failed to create team');
    } finally {
      btnCreate.disabled = false;
    }
  });

  btnJoin.addEventListener('click', async () => {
    const username = requireUser();
    if (!username) return;

    const teamCode = (teamCodeEl.value || '').trim();
    if (!/^[A-Za-z0-9]{6,10}$/.test(teamCode)) {
      toast(toastEl, 'Invalid code (6–10 alphanumeric)');
      teamCodeEl.focus();
      return;
    }

    btnJoin.disabled = true;
    try {
      const r = await fetch('/api/team/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, teamCode })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Failed');
      goChat(j.team.code);
    } catch (e) {
      toast(toastEl, e.message || 'Failed to join team');
    } finally {
      btnJoin.disabled = false;
    }
  });
})();
