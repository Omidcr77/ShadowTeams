(() => {
  const { getSessionId, toast, qs, validUsername } = window.ShadowUtil;

  const usernameEl = qs('#username');
  const teamNameEl = qs('#teamName');
  const teamDescEl = qs('#teamDesc');
  const teamCodeEl = qs('#teamCode');
  const createPassphraseEl = qs('#createPassphrase');
  const joinPassphraseEl = qs('#joinPassphrase');

  const userHelp = qs('#usernameHelp');
  const teamNameHelp = qs('#teamNameHelp');
  const teamCodeHelp = qs('#teamCodeHelp');

  const btnRandom = qs('#btnRandom');
  const btnCreate = qs('#btnCreate');
  const btnJoin = qs('#btnJoin');
  const toastEl = qs('#toast');

  getSessionId();

  const cachedUser = localStorage.getItem('shadowteams_username');
  if (cachedUser) usernameEl.value = cachedUser;

  function setUser(username) {
    localStorage.setItem('shadowteams_username', username);
  }

  function goChat(teamCode, passphrase = '') {
    const username = usernameEl.value.trim();
    setUser(username);
    sessionStorage.setItem('shadowteams_teamCode', teamCode);
    sessionStorage.setItem('shadowteams_passphrase', passphrase || '');
    sessionStorage.setItem('shadowteams_username', username);
    window.location.href = `/chat.html?code=${encodeURIComponent(teamCode)}`;
  }

  function markInput(el, ok) {
    if (!el) return;
    el.classList.toggle('ok', !!ok);
    el.classList.toggle('bad', !ok);
  }

  function validateUser(show = false) {
    const u = usernameEl.value.trim();
    const ok = validUsername(u);
    if (show) {
      markInput(usernameEl, ok || !u);
      userHelp.textContent = ok || !u
        ? '3–20 chars. Letters, numbers, underscore.'
        : 'Invalid username format.';
      userHelp.classList.toggle('error-text', !ok && !!u);
    }
    return ok;
  }

  function validateTeamName(show = false) {
    const n = teamNameEl.value.trim();
    const ok = n.length >= 2 && n.length <= 40;
    if (show) {
      markInput(teamNameEl, ok || !n);
      teamNameHelp.textContent = ok || !n ? '2–40 chars.' : 'Team name must be 2–40 characters.';
      teamNameHelp.classList.toggle('error-text', !ok && !!n);
    }
    return ok;
  }

  function validateTeamCode(show = false) {
    const c = teamCodeEl.value.trim();
    const ok = /^[A-Za-z0-9]{6,10}$/.test(c);
    if (show) {
      markInput(teamCodeEl, ok || !c);
      teamCodeHelp.textContent = ok || !c ? '6–10 alphanumeric characters.' : 'Code must be 6–10 letters/numbers.';
      teamCodeHelp.classList.toggle('error-text', !ok && !!c);
    }
    return ok;
  }

  function requireUser() {
    const ok = validateUser(true);
    if (!ok) {
      toast(toastEl, 'Please enter a valid username');
      usernameEl.focus();
      return null;
    }
    return usernameEl.value.trim();
  }

  function mapError(msg, fallback) {
    const m = String(msg || '').toLowerCase();
    if (m.includes('readonly') || m.includes('database')) return 'Server storage is read-only right now. Ask admin to fix DB permissions.';
    if (m.includes('capacity') || m.includes('full')) return 'That team is full. Try another one.';
    return msg || fallback;
  }

  usernameEl.addEventListener('input', () => validateUser(true));
  teamNameEl.addEventListener('input', () => validateTeamName(true));
  teamCodeEl.addEventListener('input', () => validateTeamCode(true));

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
      goChat(j.team.code, '');
    } catch (e) {
      toast(toastEl, mapError(e.message, 'Failed to join random team'));
    } finally {
      btnRandom.disabled = false;
    }
  });

  btnCreate.addEventListener('click', async () => {
    const username = requireUser();
    if (!username) return;
    if (!validateTeamName(true)) {
      toast(toastEl, 'Please enter a valid team name');
      teamNameEl.focus();
      return;
    }

    const teamName = teamNameEl.value.trim();
    const description = (teamDescEl.value || '').trim();
    const passphrase = (createPassphraseEl?.value || '').trim();

    btnCreate.disabled = true;
    try {
      const r = await fetch('/api/team/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, teamName, description, passphrase })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Failed');
      goChat(j.teamCode, passphrase);
    } catch (e) {
      toast(toastEl, mapError(e.message, 'Failed to create team'));
    } finally {
      btnCreate.disabled = false;
    }
  });

  btnJoin.addEventListener('click', async () => {
    const username = requireUser();
    if (!username) return;
    if (!validateTeamCode(true)) {
      toast(toastEl, 'Invalid team code format');
      teamCodeEl.focus();
      return;
    }

    const teamCode = teamCodeEl.value.trim();
    const passphrase = (joinPassphraseEl?.value || '').trim();

    btnJoin.disabled = true;
    try {
      const r = await fetch('/api/team/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, teamCode, passphrase })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Failed');
      goChat(j.team.code, '');
    } catch (e) {
      toast(toastEl, mapError(e.message, 'Failed to join team'));
    } finally {
      btnJoin.disabled = false;
    }
  });
})();
