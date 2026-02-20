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



function parseAllowlist(raw) {
  const v = String(raw || '').trim();
  if (!v) return [];
  return v.split(',').map(x => x.trim()).filter(Boolean);
}

function ipAllowed(ip, allowlist) {
  if (!allowlist.length) return true; // if unset, do not block
  const norm = String(ip || '').trim();
  return allowlist.includes(norm);
}

function buildApiRouter({ stmt, getOnlineCountByCode, getOnlineUsersByCode, createTeam, verifyTeamPassphrase, recordFallbackPresence }) {
  const router = express.Router();

  // Admin security controls
  const ADMIN_ALLOWLIST = parseAllowlist(process.env.ADMIN_ALLOWLIST || '127.0.0.1,::1,::ffff:127.0.0.1');
  const ADMIN_MAX_FAILS = Math.max(1, Number(process.env.ADMIN_MAX_FAILS || 5));
  const ADMIN_LOCK_MS = Math.max(10_000, Number(process.env.ADMIN_LOCK_MS || 10 * 60 * 1000));
  // key: remote ip -> {fails:number, lockedUntil:number}
  const adminRate = new Map();

  // POST /api/team/create {username, teamName, description?} -> {teamCode}
  router.post('/team/create', (req, res) => {
    const { username, teamName, description, passphrase } = req.body || {};
    if (!validateUsername(username)) return res.status(400).json({ error: 'Invalid username' });
    if (typeof teamName !== 'string' || teamName.trim().length < 2 || teamName.trim().length > 40) {
      return res.status(400).json({ error: 'Invalid teamName (2-40 chars)' });
    }

    const team = createTeam({
      name: teamName.trim(),
      description: typeof description === 'string' ? description.trim().slice(0, 200) : null,
      passphrase: typeof passphrase === 'string' ? passphrase : ''
    });

    return res.json({ teamCode: team.code });
  });

  // POST /api/team/join {username, teamCode} -> {team}
  router.post('/team/join', (req, res) => {
    const { username, teamCode, passphrase } = req.body || {};
    if (!validateUsername(username)) return res.status(400).json({ error: 'Invalid username' });
    if (!validateTeamCode(teamCode)) return res.status(400).json({ error: 'Invalid teamCode' });

    const team = stmt.teamByCode.get(teamCode);
    if (!team) return res.status(404).json({ error: 'Team not found' });

    if (team.passphrase_hash) {
      const ok = verifyTeamPassphrase ? verifyTeamPassphrase(team, typeof passphrase === 'string' ? passphrase : '') : false;
      if (!ok) return res.status(403).json({ error: 'Invalid room passphrase' });
    }

    return res.json({
      team: {
        code: team.code,
        name: team.name,
        description: team.description || '',
        onlineCount: getOnlineCountByCode(team.code),
        protected: !!team.passphrase_hash,
        onlineUsers: getOnlineUsersByCode ? getOnlineUsersByCode(team.code) : []
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
      if (oc > 0 && !t.passphrase_hash) candidates.push({ t, oc });
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
        onlineCount: getOnlineCountByCode(team.code),
        protected: !!team.passphrase_hash,
        onlineUsers: getOnlineUsersByCode ? getOnlineUsersByCode(team.code) : []
      }
    });
  });


  // GET /api/team/:code/presence -> {onlineCount, onlineUsers}
  router.get('/team/:code/presence', (req, res) => {
    const code = req.params.code;
    if (!validateTeamCode(code)) return res.status(400).json({ error: 'Invalid team code' });
    const team = stmt.teamByCode.get(code);
    if (!team) return res.status(404).json({ error: 'Team not found' });
    const users = getOnlineUsersByCode ? getOnlineUsersByCode(code) : [];
    return res.json({
      onlineCount: users.length,
      onlineUsers: users
    });
  });

  // POST /api/team/:code/heartbeat {username} with x-session-id -> presence heartbeat for fallback mode
  router.post('/team/:code/heartbeat', (req, res) => {
    const code = req.params.code;
    const { username } = req.body || {};
    if (!validateTeamCode(code)) return res.status(400).json({ error: 'Invalid team code' });
    if (!validateUsername(username)) return res.status(400).json({ error: 'Invalid username' });
    const team = stmt.teamByCode.get(code);
    if (!team) return res.status(404).json({ error: 'Team not found' });
    if (!req.user_hash) return res.status(400).json({ error: 'Missing x-session-id' });
    if (recordFallbackPresence) recordFallbackPresence(code, req.user_hash, username);
    return res.json({ ok: true });
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



  // POST /api/team/:code/messages {username, content} with x-session-id -> {ok, message}
  // HTTP fallback when WebSocket is blocked by client/network policy
  router.post('/team/:code/messages', (req, res) => {
    const code = req.params.code;
    if (!validateTeamCode(code)) return res.status(400).json({ error: 'Invalid team code' });

    const { username, content } = req.body || {};
    if (!validateUsername(username)) return res.status(400).json({ error: 'Invalid username' });
    const text = String(content || '').replace(/\r/g, '').trim();
    if (!text) return res.status(400).json({ error: 'Empty message' });
    if (text.length > 500) return res.status(400).json({ error: 'Message too long (max 500)' });

    if (!req.user_hash) return res.status(400).json({ error: 'Missing x-session-id' });

    const team = stmt.teamByCode.get(code);
    if (!team) return res.status(404).json({ error: 'Team not found' });

    if (recordFallbackPresence) recordFallbackPresence(code, req.user_hash, username);

    const createdAt = nowIso();
    const info = stmt.messagesInsert.run(team.id, username, req.user_hash, text, createdAt);
    const id = Number(info.lastInsertRowid);

    return res.json({ ok: true, message: { id, username, content: text, created_at: createdAt } });
  });



  // POST /api/message/:id/delete with x-session-id -> {ok}
  router.post('/message/:id/delete', (req, res) => {
    const sid = req.get('x-session-id');
    if (typeof sid !== 'string' || sid.length < 10 || !req.user_hash) {
      return res.status(400).json({ error: 'Missing x-session-id' });
    }

    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid message id' });

    const msg = stmt.messageById.get(id);
    if (!msg) return res.status(404).json({ error: 'Message not found' });
    if (msg.user_hash !== req.user_hash) return res.status(403).json({ error: 'Not your message' });
    if (msg.deleted_at) return res.json({ ok: true, alreadyDeleted: true });

    const ageMs = Date.now() - new Date(msg.created_at).getTime();
    if (!Number.isFinite(ageMs) || ageMs > 5 * 60 * 1000) {
      return res.status(400).json({ error: 'Delete window expired (5 min)' });
    }

    const when = nowIso();
    stmt.messageDeleteByOwner.run(when, req.user_hash, id, req.user_hash);
    return res.json({ ok: true, deleted_at: when, id });
  });



  // GET /api/team/:code/pin -> pinned message (if any)
  router.get('/team/:code/pin', (req, res) => {
    const code = req.params.code;
    if (!validateTeamCode(code)) return res.status(400).json({ error: 'Invalid team code' });
    const team = stmt.teamByCode.get(code);
    if (!team) return res.status(404).json({ error: 'Team not found' });
    const pin = stmt.pinByTeamId.get(team.id);
    if (!pin) return res.json({ pin: null });
    const msg = stmt.messageById.get(pin.message_id);
    if (!msg) return res.json({ pin: null });
    return res.json({ pin: { ...pin, message: { id: msg.id, username: msg.username, content: msg.content, created_at: msg.created_at } } });
  });

  // POST /api/team/:code/pin {messageId} with x-session-id -> ok
  router.post('/team/:code/pin', (req, res) => {
    if (!req.user_hash) return res.status(400).json({ error: 'Missing x-session-id' });
    const code = req.params.code;
    const messageId = Number((req.body || {}).messageId);
    if (!validateTeamCode(code)) return res.status(400).json({ error: 'Invalid team code' });
    if (!Number.isInteger(messageId) || messageId <= 0) return res.status(400).json({ error: 'Invalid messageId' });
    const team = stmt.teamByCode.get(code);
    if (!team) return res.status(404).json({ error: 'Team not found' });
    const msg = stmt.messageById.get(messageId);
    if (!msg || msg.team_id !== team.id) return res.status(404).json({ error: 'Message not found in team' });
    stmt.pinUpsert.run(team.id, messageId, req.user_hash, nowIso());
    return res.json({ ok: true });
  });

  // DELETE /api/team/:code/pin with x-session-id -> ok
  router.delete('/team/:code/pin', (req, res) => {
    if (!req.user_hash) return res.status(400).json({ error: 'Missing x-session-id' });
    const code = req.params.code;
    if (!validateTeamCode(code)) return res.status(400).json({ error: 'Invalid team code' });
    const team = stmt.teamByCode.get(code);
    if (!team) return res.status(404).json({ error: 'Team not found' });
    stmt.pinDeleteByTeamId.run(team.id);
    return res.json({ ok: true });
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
    const ip = String(req.ip || req.socket?.remoteAddress || 'unknown');

    if (!ipAllowed(ip, ADMIN_ALLOWLIST)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const now = Date.now();
    const rec = adminRate.get(ip) || { fails: 0, lockedUntil: 0 };
    if (rec.lockedUntil && rec.lockedUntil > now) {
      const retryAfter = Math.ceil((rec.lockedUntil - now) / 1000);
      return res.status(429).json({ error: `Too many failed attempts. Retry in ${retryAfter}s` });
    }

    const auth = req.get('authorization') || '';
    const token = process.env.ADMIN_TOKEN || '';
    if (!token || auth !== `Bearer ${token}`) {
      rec.fails += 1;
      if (rec.fails >= ADMIN_MAX_FAILS) {
        rec.lockedUntil = now + ADMIN_LOCK_MS;
        rec.fails = 0;
      }
      adminRate.set(ip, rec);
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // success: clear failed attempts for this ip
    adminRate.delete(ip);

    const limit = Math.max(1, Math.min(500, Number(req.query.limit || 200)));
    const rows = stmt.reportsList.all(limit);
    return res.json({ reports: rows });
  });

  // helpers exposed (used by server.js)
  router._makeCode = (min, max) => makeCode(min, max);

  return router;
}

module.exports = { buildApiRouter };
