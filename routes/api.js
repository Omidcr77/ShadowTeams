// routes/api.js
const express = require('express');

function nowIso() {
  return new Date().toISOString();
}

function validateUsername(username) {
  return typeof username === 'string'
    && username.length >= 3
    && username.length <= 20
    && /^[A-Za-z0-9_]+$/.test(username);
}

function validateTeamCode(code) {
  return typeof code === 'string'
    && code.length >= 6
    && code.length <= 10
    && /^[A-Za-z0-9]+$/.test(code);
}

function makeCode(minLen, maxLen) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghjkmnpqrstuvwxyz'; // avoid confusing chars
  const len = Math.floor(Math.random() * (maxLen - minLen + 1)) + minLen;
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function buildApiRouter({ stmt, getOnlineCountByCode, createTeam }) {
  const router = express.Router();

  // POST /api/team/create {username, teamName, description?} -> {teamCode}
  router.post('/team/create', (req, res) => {
    const { username, teamName, description } = req.body || {};
    if (!validateUsername(username)) return res.status(400).json({ error: 'Invalid username' });
    if (typeof teamName !== 'string' || teamName.trim().length < 2 || teamName.trim().length > 40) {
      return res.status(400).json({ error: 'Invalid teamName (2-40 chars)' });
    }

    const team = createTeam({
      name: teamName.trim(),
      description: typeof description === 'string' ? description.trim().slice(0, 200) : null
    });

    return res.json({ teamCode: team.code });
  });

  // POST /api/team/join {username, teamCode} -> {team}
  router.post('/team/join', (req, res) => {
    const { username, teamCode } = req.body || {};
    if (!validateUsername(username)) return res.status(400).json({ error: 'Invalid username' });
    if (!validateTeamCode(teamCode)) return res.status(400).json({ error: 'Invalid teamCode' });

    const team = stmt.teamByCode.get(teamCode);
    if (!team) return res.status(404).json({ error: 'Team not found' });

    return res.json({
      team: {
        code: team.code,
        name: team.name,
        description: team.description || '',
        onlineCount: getOnlineCountByCode(team.code)
      }
    });
  });

  // POST /api/team/random {username} -> {team}
  router.post('/team/random', (req, res) => {
    const { username } = req.body || {};
    if (!validateUsername(username)) return res.status(400).json({ error: 'Invalid username' });

    // Choose an existing active team with capacity available; else create one.
    // "Active" = has online members right now.
    const candidates = [];
    // We don't want to enumerate presence map inside here via direct access (kept abstract),
    // so we sample from DB recent teams and check online counts.
    const recentTeams = stmt.teamList.all(100); // recent 100
    for (const t of recentTeams) {
      const oc = getOnlineCountByCode(t.code);
      if (oc > 0) candidates.push({ t, oc });
    }

    candidates.sort((a, b) => a.oc - b.oc); // prefer less populated
    const capacity = Number(process.env.TEAM_CAPACITY || 15);

    const pick = candidates.find(x => x.oc < capacity);
    const team = pick ? pick.t : createTeam({ name: 'Random Team', description: 'Auto-matched anonymous room.' });

    return res.json({
      team: {
        code: team.code,
        name: team.name,
        description: team.description || '',
        onlineCount: getOnlineCountByCode(team.code)
      }
    });
  });

  // GET /api/team/:code/messages?limit=50 -> messages
  router.get('/team/:code/messages', (req, res) => {
    const code = req.params.code;
    const limitRaw = req.query.limit;
    const limit = Math.max(1, Math.min(200, Number(limitRaw || 50)));

    if (!validateTeamCode(code)) return res.status(400).json({ error: 'Invalid team code' });
    const team = stmt.teamByCode.get(code);
    if (!team) return res.status(404).json({ error: 'Team not found' });

    const rows = stmt.messagesByTeamId.all(team.id, limit);
    // reverse to chronological
    rows.reverse();
    return res.json({ messages: rows });
  });

  // POST /api/report {messageId, reason} -> ok
  // privacy: no IP, reporter derived from sessionId header
  router.post('/report', (req, res) => {
    const sessionId = req.get('x-session-id');
    if (typeof sessionId !== 'string' || sessionId.length < 10) {
      return res.status(400).json({ error: 'Missing x-session-id' });
    }

    const { messageId, reason } = req.body || {};
    const mid = Number(messageId);
    if (!Number.isInteger(mid) || mid <= 0) return res.status(400).json({ error: 'Invalid messageId' });
    if (typeof reason !== 'string' || reason.trim().length < 2 || reason.trim().length > 200) {
      return res.status(400).json({ error: 'Invalid reason (2-200 chars)' });
    }

    // Reporter hash is computed server-side in server.js and attached as req.user_hash by middleware.
    // This router assumes that middleware exists.
    if (!req.user_hash) return res.status(400).json({ error: 'Missing reporter identity' });

    const msg = stmt.messageById.get(mid);
    if (!msg) return res.status(404).json({ error: 'Message not found' });

    stmt.reportInsert.run(mid, msg.team_id, req.user_hash, reason.trim(), nowIso());
    return res.json({ ok: true });
  });

  // GET /api/admin/reports (Authorization: Bearer ADMIN_TOKEN) -> list reports
  router.get('/admin/reports', (req, res) => {
    const auth = req.get('authorization') || '';
    const token = process.env.ADMIN_TOKEN || '';
    if (!token || auth !== `Bearer ${token}`) return res.status(401).json({ error: 'Unauthorized' });

    const limit = Math.max(1, Math.min(500, Number(req.query.limit || 200)));
    const rows = stmt.reportsList.all(limit);
    return res.json({ reports: rows });
  });

  // helpers exposed (used by server.js)
  router._makeCode = (min, max) => makeCode(min, max);

  return router;
}

module.exports = { buildApiRouter };
