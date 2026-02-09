// public/js/admin.js
(() => {
  const { toast, qs } = window.ShadowUtil;

  const tokenEl = qs('#token');
  const loadBtn = qs('#loadBtn');
  const clearBtn = qs('#clearBtn');
  const reportsEl = qs('#reports');
  const toastEl = qs('#toast');

  const key = 'shadowteams_admin_token';
  const cached = sessionStorage.getItem(key);
  if (cached) tokenEl.value = cached;

  function renderReport(r) {
    const div = document.createElement('div');
    div.className = 'report';

    const title = document.createElement('h3');
    title.textContent = `Report #${r.report_id} • Team ${r.team_code} (${r.team_name})`;

    const kv = document.createElement('div');
    kv.className = 'kv';

    const pairs = [
      ['Report time', r.report_created_at],
      ['Reason', r.reason],
      ['Reporter hash', r.reporter_user_hash],
      ['Message ID', String(r.message_id)],
      ['Message user', r.message_username],
      ['Message time', r.message_created_at]
    ];

    for (const [k, v] of pairs) {
      const kk = document.createElement('div');
      kk.className = 'k';
      kk.textContent = k;

      const vv = document.createElement('div');
      vv.className = 'v';
      vv.textContent = String(v);

      kv.appendChild(kk);
      kv.appendChild(vv);
    }

    const pre = document.createElement('pre');
    pre.textContent = r.message_content;

    div.appendChild(title);
    div.appendChild(kv);
    div.appendChild(pre);
    return div;
  }

  async function load() {
    const token = (tokenEl.value || '').trim();
    if (!token) {
      toast(toastEl, 'Missing token');
      return;
    }
    sessionStorage.setItem(key, token);

    loadBtn.disabled = true;
    reportsEl.innerHTML = '';
    try {
      const r = await fetch('/api/admin/reports?limit=200', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Unauthorized');
      const list = j.reports || [];
      if (!list.length) {
        reportsEl.innerHTML = '<div class="muted">No reports yet.</div>';
      } else {
        for (const rep of list) reportsEl.appendChild(renderReport(rep));
      }
      toast(toastEl, `Loaded ${list.length} report(s)`);
    } catch (e) {
      toast(toastEl, e.message || 'Failed to load reports');
    } finally {
      loadBtn.disabled = false;
    }
  }

  loadBtn.addEventListener('click', load);
  clearBtn.addEventListener('click', () => {
    sessionStorage.removeItem(key);
    tokenEl.value = '';
    reportsEl.innerHTML = '';
    toast(toastEl, 'Token cleared');
  });
})();
