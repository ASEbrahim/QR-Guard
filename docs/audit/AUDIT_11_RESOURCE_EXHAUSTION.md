# AUDIT 11: Resource Exhaustion & Denial-of-Service

**Date**: 2026-04-18
**Scope**: QR-Guard backend (Express + Socket.IO + Drizzle/Postgres) — all HTTP endpoints, WebSocket, DB tables, external-API fan-out
**Method**: Static code review of current protections (READ-ONLY). No tests executed.
**Prior fixes confirmed in place** (per `docs/SESSION_REPORT_FULL.md`): `express.json({ limit: '10kb' })`, login 5/10min, register 10/hr, scan 60/min, global 200/min, QR token cleanup every 10 min, `audit_log.target_id` index.

---

## Executive Summary

QR-Guard's attack surface is small (only JSON POST/GET, no file uploads, no multipart, no raw body readers), and the recent hardening pass closed the most obvious memory/DoS doors. Static review confirms the 10kb body limit is global, catastrophic ReDoS is absent, and the only unbounded external fetch (`ip-api.com`) has a 3 s `AbortController` timeout.

However, the audit surfaced a substantial cluster of **unbounded SELECT** results on tables that grow forever (`sessions`, `attendance`, `enrollments`, `warning_email_log`) and a complete **absence of retention / archival** for `audit_log`, `email_verification_tokens`, `warning_email_log`, and `sessions`. Additional gaps: password-reset + reset-password endpoints are not rate-limited, no global `statement_timeout` on the PG pool, no HTTP `server.timeout` / `requestTimeout` on the Node HTTP server, no Socket.IO `maxHttpBufferSize` / `pingTimeout` override, and no max-connections policy. For a single-university deployment at AUK scale the practical blast radius is modest, but several of these are one-liner fixes and should be addressed before production.

**Overall risk**: **MEDIUM**. No "server falls over in one request" findings, but multiple slow-growth and slow-flood vectors.

---

## Summary Matrix

| # | Finding | Severity | Fix effort |
|---|---------|----------|------------|
| 1 | `express.json({limit:'10kb'})` coverage | PROTECTED (confirmed) | — |
| 2 | Unbounded SELECT: `getPerSessionReport` / `exportCsv` (all sessions × all enrolled) | **Medium** | Add date filter enforcement + hard cap |
| 3 | Unbounded SELECT: `getCourse` returns all sessions for a course | Low–Medium | Add pagination or default cap |
| 4 | Unbounded SELECT: `listCourses` / `getMyAttendance` | Low | Acceptable for AUK scale; add cap |
| 5 | CSV export size — malicious query can generate very large file | **Medium** | Row cap + streaming |
| 6 | `audit_log` growth — no retention, no archival | **Medium** | Add retention job (e.g. 1 year) |
| 7 | `email_verification_tokens` growth — used/expired rows never purged | Low–Medium | Add cleanup job |
| 8 | `warning_email_log` growth — no retention | Low | Add retention (by semester) |
| 9 | `sessions` table — old semester sessions never archived | Low | Partition or retention |
| 10 | QR token cleanup cadence vs refresh rate | PROTECTED (adequate) | — |
| 11 | Rate-limit gaps: `/api/auth/reset-password`, `/api/auth/request-rebind`, `/api/auth/verify-email`, `/api/auth/verify-rebind` (GET) | **Medium** | Add limiters |
| 12 | Scan limiter is IP-global, not per-student | Low | Add user-keyed limiter |
| 13 | Enrollment endpoint not rate-limited → enrollment-code brute force | **Medium** | Add limiter to `/api/courses/enroll` + per-id variant |
| 14 | No file-upload endpoints | PROTECTED (N/A) | — |
| 15 | `weeklySchedule` JSONB has no per-entry cap | Low | Add `.max(20)` on Zod array; cap session generation |
| 16 | ReDoS on validator regexes | PROTECTED (all linear) | — |
| 17 | Socket.IO: no `maxHttpBufferSize`, no `pingTimeout`, no per-IP connection cap | **Medium** | Set `maxHttpBufferSize: 8192`, limit handshakes |
| 18 | No Express/Node HTTP request timeout | **Medium** | Set `server.requestTimeout` / `headersTimeout` |
| 19 | No PG `statement_timeout` on pool | **Medium** | `options: '-c statement_timeout=5000'` or per-query |
| 20 | `ip-api.com` timeout honored (FAIL-OPEN) | PROTECTED | — |
| 21 | `generateSessions` bounded by body limit but still unbounded per request | Low | See #15 |
| 22 | `globalLimiter` is bypassed entirely when `NODE_ENV!=='production'` | Informational | Document; keep off in dev |

---

## Per-Finding Detail

### F1. `express.json` body limit — PROTECTED

`src/backend/server.js:38` — `app.use(express.json({ limit: '10kb' }))` is registered once, globally, before any route. No other body parser is mounted anywhere (verified: no `express.raw`, `express.urlencoded`, `express.text`, `multer`, `busboy`, `formidable` imports in `src/`). All routes inherit the 10kb cap. **Confirmed adequate.**

### F2. Unbounded SELECT — per-session report (`getPerSessionReport`, `exportCsv`)

`src/backend/controllers/report-controller.js:13-74, 136-199`

The instructor report fetches:
1. `closedSessions`: all closed sessions for the course (no `LIMIT`, no date filter by default)
2. `enrolled`: all current enrolled students (no cap)
3. `allAttendance`: `inArray(sessionId, closedSessionIds)` — ALL attendance rows for those sessions

Per course size estimate (AUK): ~50 sessions/semester × ~40 students = 2,000 rows, comfortable. Multi-year course (instructor leaves course up over multiple semesters): 400 sessions × 40 = 16,000 rows. Still OK at one-shot scale but `exportCsv` in particular builds an in-memory `rows` array then `csv-stringify/sync` stringifies synchronously — a blocking CPU/memory operation that scales with `|sessions| × |enrolled|`.

`exportCsv` DOES accept `?from=&to=` filters, but they are optional — a caller can omit them and dump everything. There is also no hard cap on the cartesian product size.

**Risk**: a malicious instructor (or compromised instructor account) can request a full multi-year CSV and block the event loop for seconds while csv-stringify runs synchronously.

**Fix**: enforce a maximum window (e.g. one semester) on `exportCsv`; require either `from` / `to` or `semester`; add `LIMIT 100_000` and 413 on overflow; consider switching to `csv-stringify` streaming (`import { stringify } from 'csv-stringify'`) and `pipe` into `res`.

### F3. Unbounded SELECT — `getCourse` returns all sessions

`course-controller.js:213-218` — returns every row in `sessions` for the course (no LIMIT, no pagination). Worst-case 400+ rows/course. Acceptable for current scale; add pagination as course detail pages get richer.

### F4. Unbounded SELECT — `listCourses`, `getMyAttendance`

`course-controller.js:152-181` and `report-controller.js:205-221` — return all enrolled courses for a user. For students this is bounded by ~6 courses/semester; for instructors by personal teaching load. Acceptable without explicit cap, but `getMyAttendance` runs a sequential `for (const c of enrolled) { calculateAttendancePct(...) }` — latency grows linearly. Consider `calculateAllAttendancePcts`-style batch fetch.

### F5. CSV export size — see F2. Additionally: there is no `Content-Length` or memory pre-check, and `res.send(csv)` buffers the entire string before writing. **Medium**.

### F6. `audit_log` growth — no retention

`db/schema/audit-log.schema.js` — every `scan_attempt`, `override`, and `auth` event is appended forever. In a university of 3,000 students scanning 3×/week across 15 weeks = ~135,000 rows/semester, times years = millions. No `DELETE` query exists anywhere in the code — `grep -n "DELETE FROM audit_log"` returns zero. The `audit_log_timestamp_idx` helps queries but not disk footprint.

`getAuditLog` in `report-controller.js:227-262` IS properly paginated (`page`, `limit` capped at 100) and uses `ORDER BY timestamp DESC LIMIT $1 OFFSET $2`. The viewer is safe. The issue is **long-term table growth + no archival policy**.

**Fix**: add a nightly/weekly job that archives rows older than N months (configurable; suggest 1 year per AUK record-retention norms) to cold storage or deletes them; OR declaratively partition by month with `pg_partman`.

### F7. `email_verification_tokens` growth

`controllers/auth-controller.js` — every `register`, `resend-verification`, `forgot-password`, and `request-rebind` INSERTs a token. `usedAt` is set on consumption, but **no DELETE happens anywhere**. Expired unused tokens linger forever; used tokens linger forever. Over years this could reach hundreds of thousands of rows. Low-medium severity because the table is keyed by `token PRIMARY KEY` and lookups stay fast, but an accumulating table is cruft.

**Fix**: add a periodic job like the existing `cleanupExpiredTokens`: `DELETE FROM email_verification_tokens WHERE (used_at IS NOT NULL AND used_at < now() - INTERVAL '30 days') OR expires_at < now() - INTERVAL '30 days'`.

### F8. `warning_email_log` growth

`db/schema/warning-email-log.schema.js` — one row per threshold crossing, never deleted. Bounded by students × courses × crossings/semester, so small, but still deserves a per-semester archival pass.

### F9. `sessions` table — no archival

Sessions from past semesters are never cleaned up. All reports and `getCourse` join against this table. Bounded growth, but pair with F6 archival strategy.

### F10. QR token cleanup — PROTECTED

`server.js:103-105`: `setInterval(cleanupExpiredTokens, 10 * 60 * 1000)` plus once on startup. `qr-service.js:107-113`: `DELETE FROM qr_tokens WHERE expires_at < now() - INTERVAL '1 hour'`. With `DEFAULT_QR_REFRESH_INTERVAL_SECONDS = 25` (`constants.js:27`), ~144 tokens/hour/active-session. Cleanup every 10 min keeps the table at worst a few thousand rows per concurrent session. **Adequate.**

### F11. Rate-limit gaps

`server.js:66-71` applies limiters to `/api/auth/login`, `/api/auth/register`, `/api/scan`, `/api/auth/verify-code`, `/api/auth/forgot-password`, `/api/auth/resend-verification`.

**Not rate-limited (only the global 200/min applies):**
- `POST /api/auth/reset-password` — attacker can brute-force a valid 64-hex-char reset token. 200/min × 1 min is not enough to brute-force a 256-bit token (fine), BUT there's no per-token lockout either, so over days an attacker could grind. Add `loginLimiter`.
- `POST /api/auth/request-rebind` — authenticated, but an authenticated student could spam rebind emails → email-provider cost and lockout. Add a dedicated limiter (e.g. 3/hour).
- `GET /api/auth/verify-email`, `GET /api/auth/verify-rebind` — brute-force surface on 64-hex-char tokens (same as above). Add limiter.

### F12. Scan limiter is IP-global (60/min), not per-student

`middleware/rate-limiter.js:29-36`. Multiple students on the same campus NAT share the limiter counter — a classroom of 40 students scanning simultaneously consumes the whole limit very quickly. Also, a single student from a dedicated IP can burn 60/min while other students from the same IP are blocked. Add `keyGenerator: (req) => req.session?.userId || req.ip` or a second per-user limiter.

### F13. Enrollment endpoint not rate-limited — enrollment-code enumeration

`route: /api/courses/enroll` and `/api/courses/:id/enroll`. Enrollment code is 6 chars from a 31-char alphabet (`ENROLLMENT_CODE_ALPHABET`, `constants.js:22`) → `31^6 ≈ 8.9×10^8`. Brute-forcing a valid code at global 200/min would take years, BUT there is no dedicated limiter and no lockout on repeated 404s. Recommend adding a dedicated low-rate limiter (e.g. 10/min per IP) and an audit log entry on 404 to surface sweeping behavior.

### F14. No file-upload endpoints — PROTECTED

Searched `src/backend` for `multer`, `busboy`, `formidable`, `express.raw`, `fileUpload`, `multipart`. No matches (lockfile reference to `formidable` is transitive via supertest, not used by app code). **Nothing to harden.**

### F15. `weeklySchedule` — no per-entry cap

`course-controller.js:24-30`: `z.array(...).min(1)` — no `.max()`. Body cap of 10kb allows maybe 150–200 entries; session generation multiplies by (semester weeks). A 52-week "year-long" semester × 150 slots = 7,800 sessions inserted in one request. Not a crash but a surprise row-count. Add `.max(14)` (twice daily × 7 days is a realistic upper bound) and validate `semesterEnd - semesterStart <= 20 weeks`.

### F16. ReDoS — PROTECTED

All regexes reviewed:
- `AUK_EMAIL_REGEX = /^[^@\s]+@auk\.edu\.kw$/i` — single character class, linear.
- `/^\d{2}:\d{2}$/` — bounded digit matcher.
- `UUID_RE` in `socket-service.js:10` — bounded fixed-length.
- `/POINT\(([-\d.]+)\s+([-\d.]+)\)/` in `qr-service.js:18` — no alternation, linear.

No nested quantifiers, no alternation with overlap. Safe.

### F17. Socket.IO — missing hardening

`services/socket-service.js:46-51`:
```js
io = new Server(httpServer, {
  cors: { origin: ..., credentials: true },
});
```
No `maxHttpBufferSize` (default is 1 MB per message — large for this app; clients only send `join-session`/`leave-session` with a UUID string). No `pingTimeout` / `pingInterval` override (defaults are fine but worth documenting). No per-IP connection cap — a single client can open thousands of sockets (each holds an auth'd session, event-loop scheduler handles them, but memory grows linearly).

Client messages are UUIDs (`UUID_RE` gate at line 68) so `maxHttpBufferSize: 8192` is safe to lower. `socket.rooms.size > 5` guards against too many joins per socket, but nothing caps total sockets per user or per IP.

**Fix**: `new Server(httpServer, { maxHttpBufferSize: 8192, pingTimeout: 20000, ... })` and maintain a small per-user socket-count map that disconnects sockets beyond a limit (e.g. 5 sockets/user).

### F18. No HTTP request timeout

`server.js:96` creates the server via `http.createServer(app)` without configuring `server.requestTimeout`, `server.headersTimeout`, or `server.keepAliveTimeout`. Node 18+ defaults to 300 s request timeout and 60 s headers timeout, which are OK, but for this app lowering to ~15 s request / ~5 s headers defends against slow-loris-style attacks. Grep confirms zero matches for `requestTimeout|headersTimeout|keepAliveTimeout|setTimeout` on the server.

### F19. No PG `statement_timeout`

`config/database.js:7-11`:
```js
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: ...,
});
```
No `options: '-c statement_timeout=5000'`, no `query_timeout`, no `idleInTransactionSessionTimeout`. A pathological query (e.g. a hostile `audit_log` full-table scan via unexpected route) can hold a connection and bog the pool. Add at minimum `statement_timeout=10000` and `idle_in_transaction_session_timeout=30000`.

### F20. `ip-api.com` timeout — PROTECTED

`validators/ip-validator.js:17-23` — `AbortController` with `IP_API_TIMEOUT_MS = 3000` (`constants.js:42`). On abort/timeout/network-error the validator FAIL-OPENs and logs. No unbounded wait. Correct.

### F21. `generateSessions` — see F15. Bounded by body size but still a per-request multiplier.

### F22. Dev-mode rate-limiter bypass (informational)

`middleware/rate-limiter.js:3-6`: `skip: () => isDev` disables ALL limiters (including `globalLimiter`) when `NODE_ENV !== 'production'`. Intentional for local testing, but make sure staging deploys set `NODE_ENV=production`. Worth a runtime assertion: if `isDev && process.env.ALLOWED_ORIGIN` contains a public domain, warn loudly.

---

## Recommended Fix Priorities

**Must-do before production:**
1. F18 — set `server.requestTimeout = 15000; server.headersTimeout = 10000;` on the HTTP server.
2. F19 — add `statement_timeout` to the PG pool (5–10 s).
3. F11 — add `loginLimiter` (or a dedicated stricter one) to `/api/auth/reset-password`, `/api/auth/verify-email`, `/api/auth/verify-rebind`, `/api/auth/request-rebind`.
4. F13 — add enrollment rate limiter.
5. F17 — lower `maxHttpBufferSize` on Socket.IO and cap sockets/user.

**Should-do (retention / growth):**
6. F6 — audit_log retention job.
7. F7 — email_verification_tokens cleanup job.
8. F2/F5 — enforce mandatory date range + row cap on CSV export.

**Nice-to-have:**
9. F12 — per-student scan limiter.
10. F15 — cap `weeklySchedule` array size and semester length.
11. F8/F9 — per-semester archival for warning log + sessions.

---

## Appendix: Files Reviewed

| File | Lines | Relevance |
|------|-------|-----------|
| `src/backend/server.js` | 1-111 | body limit, rate-limit mounting, HTTP server config |
| `src/backend/middleware/rate-limiter.js` | 1-46 | existing limiters |
| `src/backend/config/database.js` | 1-14 | PG pool (no timeouts) |
| `src/backend/config/constants.js` | 1-43 | timeouts, regex, thresholds |
| `src/backend/controllers/report-controller.js` | 13-296 | unbounded SELECTs, CSV export |
| `src/backend/controllers/course-controller.js` | 1-384 | listCourses, getCourse, enroll |
| `src/backend/controllers/auth-controller.js` | 1-414 | token flows, no token cleanup |
| `src/backend/controllers/scan-controller.js` | 1-95 | scan endpoint |
| `src/backend/controllers/override-controller.js` | 1-87 | audit_log insert |
| `src/backend/controllers/session-controller.js` | 1-106 | session start/stop |
| `src/backend/services/qr-service.js` | 1-113 | QR cleanup loop |
| `src/backend/services/socket-service.js` | 1-115 | Socket.IO init |
| `src/backend/services/notification-service.js` | 1-137 | warning_email_log writes |
| `src/backend/services/session-generator.js` | 1-68 | weeklySchedule × semester → sessions |
| `src/backend/validators/ip-validator.js` | 1-50 | ip-api.com timeout (OK) |
| `src/backend/validators/audit-logger.js` | 1-23 | audit_log insert-only |
| `src/backend/db/schema/*.schema.js` | all | confirm no retention, indexes |
