(() => {
  const { toast, qs } = window.ShadowUtil;

  const tokenEl = qs('#token');
  const loadBtn = qs('#loadBtn');
  const clearBtn = qs('#clearBtn');
  const exportBtn = qs('#exportBtn');
  const reportsEl = qs('#reports');
  const reportsMetaEl = qs('#reportsMeta');
  const toastEl = qs('#toast');

  const filterTeamEl = qs('#filterTeam');
  const filterUserEl = qs('#filterUser');
  const filterReasonEl = qs('#filterReason');
  const filterReviewedEl = qs('#filterReviewed');

  const key = 'shadowteams_admin_token';
  const reviewedKey = 'shadowteams_reviewed_reports';

  let allReports = [];

  const cached = sessionStorage.getItem(key);
  if (cached) tokenEl.value = cached;

  function getReviewedSet() {
    try {
      const raw = localStorage.getItem(reviewedKey);
      const arr = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(arr) ? arr : []);
    } catch {
      return new Set();
    }
  }

  function saveReviewedSet(set) {
    localStorage.setItem(reviewedKey, JSON.stringify([...set]));
  }

  function csvEscape(v) {
    const s = String(v ?? '');
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function exportCsv(rows) {
    if (!rows.length) {
      toast(toastEl, 'No rows to export');
      return;
    }
    const headers = [
      'report_id','team_code','team_name','report_created_at','reason','reviewed',
      'reporter_user_hash','message_id','message_username','message_created_at','message_content'
    ];
    const reviewed = getReviewedSet();
    const lines = [headers.join(',')];
    for (const r of rows) {
      lines.push([
        r.report_id, r.team_code, r.team_name, r.report_created_at, r.reason,
        reviewed.has(r.report_id) ? 'yes' : 'no',
        r.reporter_user_hash, r.message_id, r.message_username, r.message_created_at, r.message_content
      ].map(csvEscape).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `shadowteams-reports-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function filteredReports() {
    const team = (filterTeamEl.value || '').trim().toLowerCase();
    const user = (filterUserEl.value || '').trim().toLowerCase();
    const reason = (filterReasonEl.value || '').trim().toLowerCase();
    const reviewedFilter = filterReviewedEl.value;
    const reviewed = getReviewedSet();

    return allReports.filter(r => {
      if (team && !String(r.team_code || '').toLowerCase().includes(team)) return false;
      if (user && !String(r.message_username || '').toLowerCase().includes(user)) return false;
      if (reason && !String(r.reason || '').toLowerCase().includes(reason)) return false;
      const isRev = reviewed.has(r.report_id);
      if (reviewedFilter === 'yes' && !isRev) return false;
      if (reviewedFilter === 'no' && isRev) return false;
      return true;
    });
  }

  function renderReport(r) {
    const reviewed = getReviewedSet();
    const isReviewed = reviewed.has(r.report_id);

    const div = document.createElement('div');
    div.className = 'report';

    const top = document.createElement('div');
    top.className = 'row';

    const title = document.createElement('h3');
    title.textContent = `Report #${r.report_id} • Team ${r.team_code} (${r.team_name})`;
    title.style.margin = '0';

    const reviewedWrap = document.createElement('label');
    reviewedWrap.className = 'toggle';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = isReviewed;
    const tx = document.createElement('span');
    tx.textContent = 'Reviewed';
    reviewedWrap.appendChild(cb);
    reviewedWrap.appendChild(tx);

    cb.addEventListener('change', () => {
      const s = getReviewedSet();
      if (cb.checked) s.add(r.report_id); else s.delete(r.report_id);
      saveReviewedSet(s);
      applyFilters();
    });

    top.appendChild(title);
    top.appendChild(reviewedWrap);

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

    div.appendChild(top);
    div.appendChild(kv);
    div.appendChild(pre);
    return div;
  }

  function applyFilters() {
    const list = filteredReports();
    reportsEl.innerHTML = '';
    if (!list.length) {
      reportsEl.innerHTML = '<div class="muted">No matching reports.</div>';
    } else {
      for (const rep of list) reportsEl.appendChild(renderReport(rep));
    }
    reportsMetaEl.textContent = `Showing ${list.length} of ${allReports.length} report(s)`;
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
      const r = await fetch('/api/admin/reports?limit=500', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Unauthorized');
      allReports = j.reports || [];
      applyFilters();
      toast(toastEl, `Loaded ${allReports.length} report(s)`);
    } catch (e) {
      toast(toastEl, e.message || 'Failed to load reports');
    } finally {
      loadBtn.disabled = false;
    }
  }

  [filterTeamEl, filterUserEl, filterReasonEl, filterReviewedEl].forEach(el => {
    el.addEventListener('input', applyFilters);
    el.addEventListener('change', applyFilters);
  });

  exportBtn.addEventListener('click', () => exportCsv(filteredReports()));

  loadBtn.addEventListener('click', load);
  clearBtn.addEventListener('click', () => {
    sessionStorage.removeItem(key);
    tokenEl.value = '';
    reportsEl.innerHTML = '';
    reportsMetaEl.textContent = '';
    allReports = [];
    toast(toastEl, 'Token cleared');
  });
})();
