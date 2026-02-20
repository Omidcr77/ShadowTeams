// server.js
require('dotenv').config();

const http = require('http');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const WebSocket = require('ws');

const { initDb } = require('./db');
const { buildApiRouter } = require('./routes/api');

const PORT = Number(process.env.PORT || 3000);
const DB_PATH = process.env.DB_PATH || './shadowteams.sqlite';
const TEAM_CAPACITY = Number(process.env.TEAM_CAPACITY || 15);
const TEAM_CODE_MIN = Number(process.env.TEAM_CODE_MIN || 6);
const TEAM_CODE_MAX = Number(process.env.TEAM_CODE_MAX || 10);
const USER_HASH_SALT = process.env.USER_HASH_SALT || 'default_dev_salt_change_me';
const PROFANITY_FILTER = String(process.env.PROFANITY_FILTER || '0') === '1';
const DEBUG_LOGS = String(process.env.DEBUG_LOGS || '0') === '1';

function log(...args) {
  if (DEBUG_LOGS) console.log('[ShadowTeams]', ...args);
}

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
    && code.length >= TEAM_CODE_MIN
    && code.length <= TEAM_CODE_MAX
    && /^[A-Za-z0-9]+$/.test(code);
}

function hashSessionId(sessionId) {
  // stable per session + server salt; not reversible; avoids storing any IP
  return crypto.createHash('sha256').update(String(sessionId) + '|' + USER_HASH_SALT).digest('hex');
}

function hashPassphrase(passphrase) {
  return crypto.createHash('sha256').update(String(passphrase || '') + '|' + USER_HASH_SALT).digest('hex');
}

function verifyTeamPassphrase(team, passphrase) {
  if (!team || !team.passphrase_hash) return true;
  const ph = String(passphrase || '').trim();
  if (!ph) return false;
  return hashPassphrase(ph) === team.passphrase_hash;
}

function sanitizeContent(content) {
  const s = String(content || '').replace(/\r/g, '').trim();
  return s;
}

const PROFANITY_LIST = [
  'fuck', 'shit', 'bitch', 'asshole', 'bastard', 'dick', 'pussy', 'cunt'
];

function applyProfanityFilter(text) {
  if (!PROFANITY_FILTER) return text;
  let out = text;
  for (const w of PROFANITY_LIST) {
    const re = new RegExp(`\\b${w}\\b`, 'gi');
    out = out.replace(re, '****');
  }
  return out;
}

// In-memory presence and rate limiting maps (no IP)
// teamCode -> Set(ws)
const presence = new Map();
// ws -> { teamCode, username, sessionId, userHash }
const wsMeta = new Map();
// userHash -> [timestamps(ms)] recent messages
const rateMap = new Map();
// teamCode -> Map(userHash -> { username, lastSeen }) for HTTP fallback presence
const fallbackPresence = new Map();

function getOnlineCountByCode(teamCode) {
  const set = presence.get(teamCode);
  return set ? set.size : 0;
}

function getOnlineUsersByCode(teamCode) {
  const names = new Set();
  const set = presence.get(teamCode);
  if (set) {
    for (const ws of set) {
      const meta = wsMeta.get(ws);
      if (meta?.username) names.add(meta.username);
    }
  }
  const fp = fallbackPresence.get(teamCode);
  if (fp) {
    const now = Date.now();
    for (const v of fp.values()) {
      if (now - v.lastSeen <= 90_000) names.add(v.username);
    }
  }
  return [...names].sort((a,b)=>a.localeCompare(b));
}

function recordFallbackPresence(teamCode, userHash, username) {
  if (!teamCode || !userHash || !username) return;
  if (!fallbackPresence.has(teamCode)) fallbackPresence.set(teamCode, new Map());
  fallbackPresence.get(teamCode).set(userHash, { username, lastSeen: Date.now() });
}

function broadcast(teamCode, payloadObj) {
  const set = presence.get(teamCode);
  if (!set) return;
  const msg = JSON.stringify(payloadObj);
  for (const client of set) {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  }
}

function rateLimitOk(userHash) {
  // max 5 msgs / 10 seconds (per userHash)
  const now = Date.now();
  const windowMs = 10_000;
  const max = 5;
  const arr = rateMap.get(userHash) || [];
  const filtered = arr.filter(t => (now - t) <= windowMs);
  if (filtered.length >= max) {
    rateMap.set(userHash, filtered);
    return false;
  }
  filtered.push(now);
  rateMap.set(userHash, filtered);
  return true;
}

function makeCode(minLen, maxLen) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghjkmnpqrstuvwxyz';
  const len = Math.floor(Math.random() * (maxLen - minLen + 1)) + minLen;
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

// DB
const { stmt } = initDb(DB_PATH);

// Create team (ensures unique code)
function createTeam({ name, description, passphrase }) {
  let code;
  for (let i = 0; i < 10; i++) {
    code = makeCode(TEAM_CODE_MIN, TEAM_CODE_MAX);
    const exists = stmt.teamByCode.get(code);
    if (!exists) break;
    code = null;
  }
  if (!code) throw new Error('Failed to generate unique team code');

  const createdAt = nowIso();
  const passphraseHash = (typeof passphrase === "string" && passphrase.trim()) ? hashPassphrase(passphrase.trim()) : null;
  stmt.teamInsert.run(code, name, description || null, createdAt, passphraseHash);
  return stmt.teamByCode.get(code);
}

// Express app
const app = express();
app.disable('x-powered-by');

// Privacy-by-design: no request logger (no morgan)
// JSON parsing
app.use(express.json({ limit: '32kb' }));

// Helmet + CSP (strict)
app.use(helmet({
  crossOriginEmbedderPolicy: false, // keep simple for vanilla frontend
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      "default-src": ["'self'"],
      "base-uri": ["'none'"],
      "object-src": ["'none'"],
      "frame-ancestors": ["'none'"],
      "img-src": ["'self'", "data:"],
      "style-src": ["'self'"],
      "script-src": ["'self'"],
      "connect-src": ["'self'", "ws:", "wss:"],
      "form-action": ["'self'"]
    }
  },
  referrerPolicy: { policy: "no-referrer" }
}));

// Minimal middleware to attach user_hash from session header for /api/report
app.use((req, _res, next) => {
  const sid = req.get('x-session-id');
  if (typeof sid === 'string' && sid.length >= 10) {
    req.user_hash = hashSessionId(sid);
  }
  next();
});

// API routes
app.use('/api', buildApiRouter({
  stmt,
  getOnlineCountByCode,
  getOnlineUsersByCode,
  createTeam,
  verifyTeamPassphrase,
  recordFallbackPresence
}));

// Static hosting for local dev (Nginx serves in production)
app.use(express.static('public', {
  etag: false,
  lastModified: false,
  maxAge: 0
}));

// Health endpoint (no IP logging)
app.get('/health', (_req, res) => res.json({ ok: true }));

const server = http.createServer(app);

// WebSocket server mounted at /ws
const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  try {
    // only accept /ws
    const url = req.url || '';
    if (!url.startsWith('/ws')) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  } catch {
    socket.destroy();
  }
});

function removeFromPresence(ws) {
  const meta = wsMeta.get(ws);
  if (!meta) return;
  const { teamCode } = meta;
  const set = presence.get(teamCode);
  if (set) {
    set.delete(ws);
    if (set.size === 0) presence.delete(teamCode);
  }
  wsMeta.delete(ws);

  // broadcast presence update
  const onlineCount = getOnlineCountByCode(teamCode);
  broadcast(teamCode, { type: 'presence', onlineCount, onlineUsers: getOnlineUsersByCode(teamCode) });
}

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw || ''));
    } catch {
      return;
    }
    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === 'join') {
      const { teamCode, username, sessionId, passphrase } = msg;
      if (!validateTeamCode(teamCode)) {
        ws.send(JSON.stringify({ type: 'error', error: 'Invalid team code' }));
        ws.close();
        return;
      }
      if (!validateUsername(username)) {
        ws.send(JSON.stringify({ type: 'error', error: 'Invalid username' }));
        ws.close();
        return;
      }
      if (typeof sessionId !== 'string' || sessionId.length < 10) {
        ws.send(JSON.stringify({ type: 'error', error: 'Invalid sessionId' }));
        ws.close();
        return;
      }

      const team = stmt.teamByCode.get(teamCode);
      if (!team) {
        ws.send(JSON.stringify({ type: 'team_missing' }));
        ws.close();
        return;
      }

      if (!verifyTeamPassphrase(team, passphrase)) {
        ws.send(JSON.stringify({ type: 'error', error: 'Invalid room passphrase' }));
        ws.close();
        return;
      }

      // capacity check (online only)
      const currentOnline = getOnlineCountByCode(teamCode);
      if (currentOnline >= TEAM_CAPACITY) {
        ws.send(JSON.stringify({ type: 'error', error: 'Team is full' }));
        ws.close();
        return;
      }

      // join presence
      if (!presence.has(teamCode)) presence.set(teamCode, new Set());
      presence.get(teamCode).add(ws);

      const userHash = hashSessionId(sessionId);
      wsMeta.set(ws, { teamCode, username, sessionId, userHash });

      // ack
      ws.send(JSON.stringify({
        type: 'joined',
        team: { code: team.code, name: team.name, description: team.description || '', protected: !!team.passphrase_hash },
        onlineCount: getOnlineCountByCode(teamCode),
        onlineUsers: getOnlineUsersByCode(teamCode)
      }));

      // broadcast presence update
      broadcast(teamCode, { type: 'presence', onlineCount: getOnlineCountByCode(teamCode), onlineUsers: getOnlineUsersByCode(teamCode) });
      return;
    }

    const meta = wsMeta.get(ws);
    if (!meta) {
      ws.send(JSON.stringify({ type: 'error', error: 'Not joined' }));
      return;
    }

    if (msg.type === 'typing') {
      const isTyping = !!msg.isTyping;
      // broadcast typing to others (no persistence)
      broadcast(meta.teamCode, { type: 'typing', username: meta.username, isTyping });
      return;
    }

    if (msg.type === 'message') {
      const contentRaw = sanitizeContent(msg.content);
      if (!contentRaw) return;
      if (contentRaw.length > 500) {
        ws.send(JSON.stringify({ type: 'error', error: 'Message too long (max 500)' }));
        return;
      }

      if (!rateLimitOk(meta.userHash)) {
        ws.send(JSON.stringify({ type: 'rate_limited', error: 'Too many messages. Slow down.' }));
        return;
      }

      const team = stmt.teamByCode.get(meta.teamCode);
      if (!team) {
        ws.send(JSON.stringify({ type: 'team_missing' }));
        ws.close();
        return;
      }

      const content = applyProfanityFilter(contentRaw);
      const createdAt = nowIso();

      const info = stmt.messagesInsert.run(team.id, meta.username, meta.userHash, content, createdAt);
      const id = Number(info.lastInsertRowid);

      broadcast(meta.teamCode, {
        type: 'message',
        id,
        username: meta.username,
        content,
        created_at: createdAt
      });
      return;
    }

    if (msg.type === 'delete_message') {
      const id = Number(msg.id);
      if (!Number.isInteger(id) || id <= 0) {
        ws.send(JSON.stringify({ type: 'error', error: 'Invalid message id' }));
        return;
      }

      const existing = stmt.messageById.get(id);
      if (!existing) {
        ws.send(JSON.stringify({ type: 'error', error: 'Message not found' }));
        return;
      }
      if (existing.team_id !== stmt.teamByCode.get(meta.teamCode).id) {
        ws.send(JSON.stringify({ type: 'error', error: 'Wrong team' }));
        return;
      }
      if (existing.user_hash !== meta.userHash) {
        ws.send(JSON.stringify({ type: 'error', error: 'Not your message' }));
        return;
      }
      if (existing.deleted_at) {
        ws.send(JSON.stringify({ type: 'message_deleted', id, deleted_at: existing.deleted_at }));
        return;
      }

      const ageMs = Date.now() - new Date(existing.created_at).getTime();
      if (!Number.isFinite(ageMs) || ageMs > 5 * 60 * 1000) {
        ws.send(JSON.stringify({ type: 'error', error: 'Delete window expired (5 min)' }));
        return;
      }

      const when = nowIso();
      stmt.messageDeleteByOwner.run(when, meta.userHash, id, meta.userHash);
      broadcast(meta.teamCode, { type: 'message_deleted', id, deleted_at: when });
      return;
    }

  });

  ws.on('close', () => removeFromPresence(ws));
  ws.on('error', () => removeFromPresence(ws));
});


setInterval(() => {
  const now = Date.now();
  for (const [teamCode, m] of fallbackPresence.entries()) {
    for (const [key, v] of m.entries()) {
      if (now - v.lastSeen > 120_000) m.delete(key);
    }
    if (m.size === 0) fallbackPresence.delete(teamCode);
  }
}, 30_000);

server.listen(PORT, '127.0.0.1', () => {
  log(`Server listening on http://127.0.0.1:${PORT}`);
});
