<!-- README.md -->
# ShadowTeams (Anonymous Stranger Team Chat)

A Tor-style privacy-inspired anonymous chat app (standard web app; can be hosted behind Tor by the operator).
No emails, no passwords, no phone numbers, no social logins. Only a username.

**Privacy-by-design:**
- No IP addresses stored in SQLite
- No request logging middleware (no morgan)
- Nginx config shows how to disable access logs
- Session identity is a random UUID stored in `localStorage`
- Server derives `user_hash = sha256(sessionId + USER_HASH_SALT)` for rate limit & reports

---

## Features

- Landing page:
  - Username (required, 3–20 chars, letters/numbers/_)
  - Join Random Team
  - Create Team (name + optional description)
  - Join Team by Code
- Teams:
  - Short join code (6–10 chars)
  - Random matching prefers active teams with free capacity
- Chat:
  - WebSocket real-time chat
  - Message bubbles, timestamps, username
  - Typing indicators
  - Online member count
  - Leave button
- Safety-lite:
  - Rate limit: **max 5 msgs / 10 seconds** per session hash
  - Profanity filter:
    - Server-side toggle via `PROFANITY_FILTER=1`
    - Optional local (client-side) filter toggle in chat UI
  - Report message -> stored in SQLite (no IP)
  - Admin page -> view reports with `ADMIN_TOKEN`

---

## Prerequisites

- Node.js 18+ (recommended 20+)
- npm
- (Production) Nginx

---

## Install & Run (local)

```bash
git clone <your repo> shadowteams
cd shadowteams

cp .env.example .env
# edit .env (set ADMIN_TOKEN and USER_HASH_SALT)

npm install
npm start

## Backup & Restore (Phase 4.1)

### Backup now

```bash
sudo /var/www/shadowteams/deploy/backup-shadowteams.sh
```

Default paths:
- DB: `/var/www/shadowteams/data/shadowteams.sqlite`
- Backups: `/var/backups/shadowteams`
- Retention: `KEEP_DAYS=14`

### Restore from backup

```bash
sudo /var/www/shadowteams/deploy/restore-shadowteams.sh /var/backups/shadowteams/shadowteams-YYYYMMDD-HHMMSS.sqlite.gz
```

This will:
1. Validate backup integrity
2. Stop `shadowteams` service
3. Replace DB file (with pre-restore copy)
4. Start service again

### Daily backup cron example

```bash
sudo crontab -e
```

Add:

```cron
15 2 * * * KEEP_DAYS=14 /var/www/shadowteams/deploy/backup-shadowteams.sh >> /var/log/shadowteams-backup.log 2>&1
```

### Automated schedule installed (Phase 4.2)

The server now has:

- `/etc/cron.d/shadowteams-backup`  
  Runs daily at **02:15 UTC**:
  `KEEP_DAYS=14 /var/www/shadowteams/deploy/backup-shadowteams.sh`

- `/etc/logrotate.d/shadowteams-backup`  
  Rotates `/var/log/shadowteams-backup.log` daily, keeps 14 compressed logs.

### Healthcheck schedule installed (Phase 4.3)

The server now has:

- `/etc/cron.d/shadowteams-healthcheck`  
  Runs every 15 minutes:
  `/var/www/shadowteams/deploy/healthcheck-shadowteams.sh`

- `/etc/logrotate.d/shadowteams-healthcheck`  
  Rotates `/var/log/shadowteams-healthcheck.log` daily, keeps 14 compressed logs.

Manual run:

```bash
sudo /var/www/shadowteams/deploy/healthcheck-shadowteams.sh
```

### Phase 4.5 cleanup + startup checks

- Nginx disabled/cleared (ShadowTeams currently runs directly on Node+Tor)
- Healthcheck now treats inactive nginx as `disabled` by default (`NGINX_REQUIRED=0`)
- Added startup self-check hook via systemd drop-in:
  - `/etc/systemd/system/shadowteams.service.d/override.conf`
  - runs `/var/www/shadowteams/deploy/startup-selfcheck-shadowteams.sh`

If you require nginx later, set:

```bash
NGINX_REQUIRED=1
```

in cron environment or healthcheck invocation.

### Phase 5: Admin endpoint protection

`/api/admin/reports` now has:

1. **IP allowlist (optional)** via `.env`:
   - `ADMIN_ALLOWLIST=127.0.0.1,::1,::ffff:127.0.0.1`
   - If unset, endpoint is not IP-restricted.

2. **Brute-force lockout**:
   - `ADMIN_MAX_FAILS` (default: `5`)
   - `ADMIN_LOCK_MS` (default: `600000` = 10 min)

After repeated failed token attempts from same IP, endpoint returns HTTP 429 until lock expires.

## Phase 6 (UX + trust features)

Implemented:

- Invite UX upgrades:
  - copy invite text from chat header
  - clearer room-code context + room switch toast
- Optional room passphrase protection:
  - set passphrase when creating team
  - required on join for protected rooms
  - WebSocket join also enforces passphrase
- Sender-side delete (time-limited):
  - delete own message within 5 minutes
  - works in realtime and fallback mode
- Anti-spam UX:
  - lightweight send cooldown (~900ms)

Notes:
- Passphrase is stored as hash (`passphrase_hash`) in DB.
- Message deletion marks content as `[deleted]` and records delete metadata.


## Release v1.0.0

ShadowTeams now includes:
- advanced chat UX (search, pin, timeline, jump-to-latest)
- fallback mode for blocked realtime channels
- room passphrase protection
- sender delete window
- admin filtering/export and endpoint hardening
- automated backup + healthcheck ops
