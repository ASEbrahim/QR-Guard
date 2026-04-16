# QR-Guard

Location-based QR attendance system with 6-layer anti-fraud verification for the American University of Kuwait.

**Course:** CSIS 330 - Software Engineering | **Professor:** Dr. Aaron Rababaah

## Stack

| Layer | Technology |
|---|---|
| Backend | Node.js + Express |
| Database | PostgreSQL + PostGIS (Neon) |
| ORM | Drizzle |
| Real-time | Socket.IO |
| Frontend | Vanilla HTML / CSS / JS |
| QR | qrcode.js + html5-qrcode |
| GPS | Browser Geolocation API |
| IP verification | ip-api.com |
| Device binding | FingerprintJS (open-source) |
| Email | Resend |

## Anti-Fraud Pipeline

Every scan passes through 6 checks in order (cheapest first, fail-fast):

1. **QR Validator** - token valid for current refresh cycle
2. **Device Checker** - fingerprint matches stored binding
3. **IP Validator** - country = Kuwait, no VPN/proxy
4. **GPS Accuracy Checker** - accuracy <= 150m and != 0
5. **Geofence Checker** - PostGIS ST_DWithin (radius + 15m margin)
6. **Audit Logger** - every attempt logged regardless of result

## Project Structure

```
docs/           Design documents, FRS, UML diagrams, schema
increments/     Per-increment plans and notes
sprint-prompts/ Copy-paste prompts for Claude Code
src/
  backend/      Express server, controllers, validators, services
  frontend/     Vanilla HTML/CSS/JS pages
tests/          Vitest unit + integration tests
```

## Development

```bash
npm install
cp .env.example .env    # fill in your values
npm run dev             # start dev server
npm test                # run tests
npm run lint            # check code style
```

## Build Plan

5 increments, built sequentially:

1. Authentication & accounts (FR1)
2. Course management (FR2)
3. Dynamic QR & scan pipeline (FR3-4) - critical path
4. Reports & analytics (FR5)
5. Notifications, override, audit, hardening (FR6-7)

See `docs/INCREMENTS.md` for full acceptance criteria.

## Deployment

**Production: Render + Neon (free)**

1. Create a database at [neon.tech](https://neon.tech) (free, PostGIS included)
   - Run the 3 migration files in `drizzle/` against it
2. Create a Web Service at [render.com](https://render.com) connected to this GitHub repo
   - Set env vars: `DATABASE_URL` (Neon connection string), `NODE_ENV=production`, `BASE_URL=https://your-app.onrender.com`
   - Render auto-detects `render.yaml` for build/start commands
3. Done — HTTPS, WebSocket, GPS, camera all work on any device

**Local development:**

```bash
npm install
cp .env.example .env    # fill in local Postgres URL
npm run dev             # http://localhost:3000
```
