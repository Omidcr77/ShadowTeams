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
