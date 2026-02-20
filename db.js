// db.js
const Database = require('better-sqlite3');

function columnExists(db, table, column) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some(r => r.name === column);
}

function initDb(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Base schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      user_hash TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(team_id) REFERENCES teams(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      team_id INTEGER NOT NULL,
      reporter_user_hash TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY(team_id) REFERENCES teams(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_messages_team_created ON messages(team_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at);
  `);

  // Lightweight migrations
  if (!columnExists(db, 'teams', 'passphrase_hash')) {
    db.exec(`ALTER TABLE teams ADD COLUMN passphrase_hash TEXT`);
  }
  if (!columnExists(db, 'messages', 'deleted_at')) {
    db.exec(`ALTER TABLE messages ADD COLUMN deleted_at TEXT`);
  }
  if (!columnExists(db, 'messages', 'deleted_by_user_hash')) {
    db.exec(`ALTER TABLE messages ADD COLUMN deleted_by_user_hash TEXT`);
  }

  const stmt = {
    teamByCode: db.prepare(`SELECT * FROM teams WHERE code = ?`),
    teamInsert: db.prepare(`INSERT INTO teams (code, name, description, created_at, passphrase_hash) VALUES (?, ?, ?, ?, ?)`),
    teamList: db.prepare(`SELECT * FROM teams ORDER BY id DESC LIMIT ?`),

    messagesInsert: db.prepare(`
      INSERT INTO messages (team_id, username, user_hash, content, created_at)
      VALUES (?, ?, ?, ?, ?)
    `),
    messagesByTeamId: db.prepare(`
      SELECT id, username, content, created_at, deleted_at
      FROM messages
      WHERE team_id = ?
      ORDER BY id DESC
      LIMIT ?
    `),
    messageById: db.prepare(`
      SELECT id, team_id, username, user_hash, content, created_at, deleted_at, deleted_by_user_hash
      FROM messages
      WHERE id = ?
    `),
    messageDeleteByOwner: db.prepare(`
      UPDATE messages
      SET content = '[deleted]', deleted_at = ?, deleted_by_user_hash = ?
      WHERE id = ? AND user_hash = ? AND deleted_at IS NULL
    `),

    reportInsert: db.prepare(`
      INSERT INTO reports (message_id, team_id, reporter_user_hash, reason, created_at)
      VALUES (?, ?, ?, ?, ?)
    `),
    reportsList: db.prepare(`
      SELECT
        r.id AS report_id,
        r.created_at AS report_created_at,
        r.reason,
        r.reporter_user_hash,
        m.id AS message_id,
        m.username AS message_username,
        m.content AS message_content,
        m.created_at AS message_created_at,
        t.code AS team_code,
        t.name AS team_name
      FROM reports r
      JOIN messages m ON m.id = r.message_id
      JOIN teams t ON t.id = r.team_id
      ORDER BY r.id DESC
      LIMIT ?
    `)
  };

  return { db, stmt };
}

module.exports = { initDb };
