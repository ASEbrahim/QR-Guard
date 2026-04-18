# QR-Guard — Complete Session Report (Build + Audit + Remediation)

**Project**: QR-Guard — a location-based QR attendance system for AUK (American University of Kuwait), with a 6-layer anti-fraud verification pipeline.
**Live**: https://qrguard.strat-os.net (Render + Neon)
**Repo**: https://github.com/ASEbrahim/QR-Guard
**Period**: April 16–18, 2026 (single continuous Claude Code session)
**Current HEAD**: `319f124` (branch `main`; pushed)

This document is a **single-paste context artifact** — self-contained, readable without the codebase. For deeper detail, see `docs/audit/` (14 audit findings files + 4 remediation summaries).

---

## 1. What QR-Guard Is

Node.js + Express + PostgreSQL/PostGIS attendance system. Students scan a rotating QR code during class; the system verifies attendance through six independent checks before recording it.

### Stack

| Layer | Tech |
|---|---|
| Runtime | Node ≥20, ESM |
| Web | Express 5, helmet, cors, `express-rate-limit`, `express-session` + `connect-pg-simple` |
| DB | PostgreSQL + PostGIS on Neon (via `node-postgres` + Drizzle ORM) |
| Real-time | Socket.IO 4.8.3 |
| Email | Resend (prod) / console (dev) |
| Frontend | Vanilla HTML/CSS/JS; Leaflet (maps), html5-qrcode (camera scanner), qrcodejs (client-side QR render), FingerprintJS (device binding) |
| Testing | Vitest (43 unit + integration); Playwright (screenshot smoke) |
| Hosting | Render (web) + Neon (DB) + Resend (email) + Cloudflare (DNS) |

### Scale at current HEAD

- 86 git commits total
- 65 source files, ~7,460 LOC
- **12 DB tables**, **7 migrations** (3 original + 4 from audit remediation)
- **31 API endpoints**
- **43 automated tests**, all passing
- **15 prod deps + 7 dev deps**

### The 6-layer scan pipeline (this is load-bearing for the product)

On each scan, `POST /api/scan` runs these in order, short-circuiting on the first failure. Every attempt is recorded in `audit_log`.

1. **QR validator** — decode Base64, look up token in DB, check it's not expired
2. **Device checker** — match FingerprintJS visitor ID against the student's bound device (binding happens at first login)
3. **IP validator** — ip-api.com call, require country=Kuwait + no VPN/proxy. **FAIL-OPEN** on timeout (logged)
4. **GPS accuracy checker** — reject if accuracy > 150 m or === 0 (likely spoofed)
5. **Geofence checker** — PostGIS `ST_DWithin(ST_GeogFromText(...), ...)` + 15 m margin
6. **Audit logger** — records the attempt (success or rejected) with full context

### Roles

- **Student**: registers publicly via `@auk.edu.kw` email + 6-digit verification code; enrolls in courses by 6-char enrollment code; scans QR during class
- **Instructor**: seeded via `scripts/seed.js` (NOT publicly registerable — that was the critical vuln P0-1, see below); creates courses + geofence + weekly schedule, starts/stops sessions, overrides attendance, views reports

---

## 2. Build Phase (April 16–17, pre-audit)

Three sprints delivered the full app from empty repo:

- **Sprint A** — Auth (register, login, lockout, password reset, device rebind) + Courses (create, enroll-by-code, weekly schedule → auto-generated sessions, Leaflet geofence). 14 tests.
- **Sprint B** — Dynamic QR (25 s refresh via `setInterval`, Socket.IO push + HTTP polling fallback) + Scan pipeline (6 layers). 22 new tests.
- **Sprint C** — Reports + Notifications + Hardening (warning emails on attendance threshold crossing, AUK 15% absence limit, CSV export, rate limits, helmet). 7 new tests.

**Prior to the comprehensive audit**, 8 lighter audit passes had already been applied with 77 findings → 65 fixed. Those earlier fixes included: session fixation, CORS lockdown, open-redirect validation, XSS in course.html, SSL reject-unauthorized, Socket.IO authentication, IDOR on per-student report (student-self branch only), N+1 query fixes in some reports, etc.

See `docs/SESSION_REPORT_FULL.md` for the original build narrative (UI iterations, deployment, infrastructure decisions).

---

## 3. Comprehensive 13-Category Audit (April 18 morning)

**Methodology**: StratOS audit template (see `~/Downloads/StratOS/docs/audit/comprehensive-audit-20260324/`). 13 parallel agents, each meticulously covering one category, with explicit instructions to NOT repeat prior-audit findings.

**Output**: `docs/audit/AUDIT_01` through `AUDIT_13.md` (~325 KB) + `docs/audit/UNIFIED_REMEDIATION_PLAN.md` (triage).

### Findings count

| # | Category | Findings | Critical | High | Medium | Low/Info |
|---|---|---:|---:|---:|---:|---:|
| 1 | Big O Complexity | 15 | 0 | 3 | 7 | 5 |
| 2 | Concurrency | 11 | 1 | 4 | 4 | 2 |
| 3 | SQL Injection | 0 (+2 info) | 0 | 0 | 0 | 2 |
| 4 | Dead Code | ~10 | 0 | 0 | 2 | 8 |
| 5 | Error Propagation | 27 | 2 | 8 | 13 | 4 |
| 6 | Auth Boundaries | 12 | 1 | 2 | 3 | 6 |
| 7 | Data Consistency | 23 | 3 | 7 | 9 | 4 |
| 8 | Configuration Drift | 20 | 0 | 4 | 6 | 10 |
| 9 | Memory Leaks | 9 | 0 | 2 | 4 | 3 |
| 10 | Dependencies | 10 | 0 | 2 | 5 | 3 |
| 11 | Resource Exhaustion | 22 | 0 | 0 | 10 | 12 |
| 12 | Latency Profiling | 17 | 0 | 3 | 9 | 5 |
| 13 | Accessibility | 60 | 0 | 6 | 25 | 29 |
| | **Total new (non-duplicate)** | **≈236** | **7** | **41** | **97** | **91** |

### Cross-audit corroborations (same bug flagged independently by 2+ agents — strongest signals)

1. **Instructor self-registration via body `role`** — AUDIT_06 CRITICAL + AUDIT_08 MEDIUM (docs drift)
2. **`audit_log_target_idx` claimed in docs but not present** — AUDIT_01, AUDIT_07, AUDIT_08, AUDIT_12 all hit this
3. **Audit-log-before-attendance inversion** — AUDIT_05 CRITICAL + AUDIT_07 CRITICAL
4. **Override has 3 writes without a transaction** — AUDIT_02 + AUDIT_05 + AUDIT_07
5. **No unhandled-rejection / SIGTERM handlers** — AUDIT_05 CRITICAL + AUDIT_09 HIGH
6. **Multi-instance deployment landmines** (in-memory `activeLoops`, unconditional orphan-cleanup at startup) — AUDIT_02 + AUDIT_07

### Clean bills of health

- **SQL injection**: 0 exploitable. 8 raw-SQL sites audited, all parameterised. Two advisory info-items.
- **Dead code**: only ~140 removable lines remained after prior passes.
- **Scan pipeline design itself**: genuinely O(1) per layer, well separated, FAIL-OPEN on ip-api documented.

---

## 4. Remediation — 4 Staged Passes (April 18, afternoon → evening)

23 commits, each a discrete reversible unit with tests run after every commit. Pattern for each pass: backup tag → themed batches → commits → `npm test` (43/43) → `npm run lint` (clean) → push + tag. Anything requiring a product/infra decision was **deferred explicitly** rather than silently chosen.

### P0 — Security-critical (8 commits, ~6-7 hours)

| # | Ref | SHA | Fix |
|---|---|---|---|
| 1 | P0-3 | `9d1d8ae` | `SESSION_SECRET` guard checked `'change-me'` but `.env.example` ships `'change-me-in-production'` — copy-paste deploys bypassed the crash-on-default. Fixed to list both. |
| 2 | P0-1 | `fcc636e` | **Instructor self-registration** — register endpoint accepted `role` from body. Any `@auk.edu.kw` could provision as instructor. Stripped `role` + `employeeId` from Zod schema; forced `role='student'` server-side. Instructor accounts via seed only. |
| 3 | P0-7 | `c04cb8d` | Reset-password unconditionally zeroed `failedLoginCount` + `lockedUntil` — acted as a lockout bypass. Now only updates password hash. |
| 4 | P0-6 | `abd57b3` | Reset-password didn't invalidate existing sessions — stolen cookies survived the reset. Now `DELETE FROM session WHERE sess->>'userId' = $1` outside the transaction, tolerant of missing session table. |
| 5 | P0-4 | `e423cf0` | **Audit-log ordering inversion** — `scan-verifier` wrote `audit_log{result:'success'}` in `finally` BEFORE `scan-controller` inserted the attendance row. A non-UNIQUE attendance-insert error left an orphan "success" audit. Restructured: verifier logs rejections only; controller logs success AFTER attendance commits. UNIQUE-violation path now audits as `already_recorded`; other insert errors audit as `attendance_insert_failed`. |
| 6 | P0-5 | `48135c4` | **No graceful shutdown** — token-cleanup `setInterval` handle discarded, `pool.end()` never called, zero `SIGTERM`/`unhandledRejection`/`uncaughtException` handlers. Node 20 defaults to crash-on-unhandled-rejection. Added `shutdown(signal)` that stops interval, drains QR refresh loops, closes Socket.IO, closes HTTP server, ends pool. 15 s force-exit safety timer. Idempotent. |
| 7 | P0-2 | `e499160` | **QR tokens leaked to third-party `api.qrserver.com`** — every 25 s refresh sent a valid scan-authorization token to a remote service. Replaced with client-side `qrcodejs` from cdnjs (pinned to v1.0.0, SHA-384 SRI hash, `crossorigin="anonymous"`, `referrerpolicy="no-referrer"`). Signed payload never leaves the browser. |
| 8 | P0-8 | `ad7710d` | **Zero DB-level CHECK constraints** — every enum (role, session.status, attendance.status, audit_log.event_type + .result, email_verification_tokens.purpose) was enforced only in Drizzle's TS layer. Any raw SQL path bypassed. New migration `0003_enum_checks.sql` adds a CHECK for each, with `_rollback.sql` alongside. |

### P1 — High priority (5 commits)

| Batch | SHA | Items |
|---|---|---|
| A Security | `5821c21` | **IDOR** on `getPerStudentReport` (instructor branch didn't verify target student is enrolled); **over-reach** on override (body `studentId` wasn't validated as enrolled); session destroy on device-rebind; rate-limit gaps on `reset-password`, `verify-email`, `verify-rebind`, `request-rebind`, `/api/courses/enroll`. |
| B Data | `45081c6` | **Transactions** wrapping `createCourse` (course + sessions) and `overrideAttendance` (existence-check + upsert + audit). **Warning-log concurrency** fixed: migration `0004` adds partial unique index `(course_id, student_id) WHERE recovered_above_at IS NULL`; `checkThresholdAndNotify` now does `INSERT ... ON CONFLICT DO NOTHING` to atomically claim a crossing, emails AFTER the claim, DELETEs the claim if email fails (retryable). **Kuwait timezone drift** fixed: session-generator was using `new Date('2026-02-01')` (UTC midnight) + `setHours` (local TZ) → Kuwait classes landed 3 h off on Render's UTC host. Now all timestamps built as explicit UTC instants whose Kuwait wall-clock matches the schedule. **`updateCourse` Zod** now validates all updatable fields. |
| C Perf | `c7930bd` | Migration `0005` adds three missing indexes: `audit_log_target_idx` (promised by docs × 3, never shipped), `courses_instructor_idx`, `enrollments_student_idx` (composite PK doesn't serve student_id-only queries). Scan hot-path 3-way JOIN flattened to two index-seek subselects. `getMyAttendance` N+1 fixed via new bulk `calculateAttendancePctsForStudent`. |
| D Ops | `7de9266` | `ALLOWED_ORIGIN` + `RESEND_API_KEY` in `.env.example` and `render.yaml`. Migration `0006` `CREATE EXTENSION IF NOT EXISTS postgis` (Neon has it pre-enabled; local dev DBs would have silently failed on first geofence scan). PG `statement_timeout = 15s`, `pool.max = 25`. HTTP `requestTimeout=30s`, `headersTimeout=15s`, `keepAliveTimeout=65s` (> Render LB 60 s). **SRI hashes** on every CDN asset: Leaflet CSS + JS, `socket.io` pinned 4.7.5 → 4.8.3 matching server, `html5-qrcode` 2.3.8. **FingerprintJS** moved from floating `v4` to `v4.5` (ESM dynamic `import()` doesn't support SRI — concrete-version pin is the best equivalent). |
| E A11y | `e961ef5` | **Skip link actually works** (previously pointed to `#main-content` but no page had that id — prior "fix" was a dead anchor). Now `ensureSkipLink()` runs on both `renderNav` and `renderNavWithBack`, and a microtask marks the first content element with `id="main-content"` + `tabindex="-1"` + `role="main"`. **aria-live** on attendance counter + scan result + GPS status. **Modal focus trap** (openModal/closeModal helpers, Tab/Shift+Tab cycling, return focus on close) wired into instructor course sheet + student enrol sheet. **Form labels** on create-course form all have matching `for=`. **Keyboard equivalent** for Leaflet map (Enter/Space at current center). `prefers-reduced-motion` respected globally. |

### P2 — Medium priority (4 batch commits)

| Batch | SHA | Items |
|---|---|---|
| F Error + memory | `4f316d3` | Socket.IO `join-session` try/catch (async DB handler could have become unhandled rejection → shutdown). `scan.html` parses `res.json()` defensively against 502 HTML responses. `session.html` End-Session only transitions to closed state on `res.ok`. `qr-service` throws on malformed WKT instead of silently falling back to (0,0). Global error handler logs request context (method, url, userId, role, IP). Zod schemas on `verifyCode` / `forgotPassword` / `resendVerification` (previously ad-hoc `if (!email)`). Camera `MediaStream` stopped on `pagehide` + `visibilitychange`. Socket + polling teardown on `pagehide`. Leaflet `map.remove()` on `pagehide`. `ip-validator` `clearTimeout` moved to `finally`. |
| G Limits + perf | `149edc8` | Socket.IO `maxHttpBufferSize: 4*1024` (was 1 MB default). CSV export hard cap 100k rows (413 with guidance above). `weeklySchedule` Zod `.max(14)`. Scan limiter `keyGenerator` prefers `req.session.userId` with IP fallback (NAT'd classroom no longer shares one counter). `Promise.all` parallelisation in `getAuditLog` (entries + count) and `getPerStudentReport` (closed-sessions + student lookup + pct). `calculateAllAttendancePcts` CROSS JOIN → per-student aggregation (n×m materialisation eliminated; math equivalence documented). |
| H A11y polish | `f525877` | `togglePassword` flips `aria-pressed` + `aria-label`. `<h1>` landmarks on `course.html` (visible), `scan.html` (visible), `session.html` (visually-hidden). `role="main"` on skip-link target. Full keyboard-driven tabs widget on `course.html` (roving tabindex, Arrow/Home/End). `setButtonLoading` sets `aria-busy="true"` + `disabled` (prevents double-submit AND announces state to SR). |
| I P3 cleanup | `3e95f9d` | Removed unused `apiPut`, `showSkeletons`. Removed 11 dead CSS selectors (~75 lines: `.badge*`, `.sheet-section-label`, `.quick-pick*`, `.sheet-divider*`). Fixed email-service docstring (claimed 3 modes, only 2 implemented). `test-results/` + `playwright-report/` added to `.gitignore`. |

### P3 + late catches (3 commits)

| SHA | Item |
|---|---|
| `df45193` | Socket.IO `connect_error` handler. `doLogout` surfaces failure to console (still navigates — local state resets either way). Bottom-nav `aria-current="page"` on active link; icon spans marked `aria-hidden="true"` so SR speak text labels. Nominatim debounce raised 300 ms → 1000 ms (OSM's 1 req/sec ToS). |
| `48ca886` | Expired-token retention: `cleanupExpiredTokens` now also purges `email_verification_tokens` where `expires_at < now() - 7 days` OR `used_at < now() - 30 days`. `SCHEMA.md` drift fixed (4 new reason codes, new indexes, warning-log partial unique documented). |
| `17510a3` | **Caught by live validation smoke**: express-rate-limit raised `ERR_ERL_KEY_GEN_IPV6` on first boot — my P2-G scan `keyGenerator` used raw `req.ip` which lets an IPv6 attacker rotate through a /64 to bypass the limit. Switched to the library's `ipKeyGenerator` helper (normalises to /64 prefix). |

### What validation caught that code review didn't

- **IPv6 bypass** — only surfaced when I actually booted the server against the P2 limiter change. Library's startup validator flagged it.
- **Migration not auto-applied** — the project has drizzle-kit config but no `db:migrate` script, so migrations are CI/doc artifacts. Applied manually against local Neon-compatible PostgreSQL during each P0/P1 batch to verify constraints hold on real data.
- **Missing ipKeyGenerator import** only needed after the live smoke test, which is why the deployment checklist below includes a real browser/curl smoke round.

---

## 5. Current State (what's on `main` at `319f124`)

### Security posture

- Public registration is student-only, enforced at Zod + DB CHECK layer
- Sessions destroyed on password reset + device rebind
- Lockout not clearable via reset
- CORS locked to `ALLOWED_ORIGIN` (required in prod)
- Socket.IO authenticated + buffer capped at 4 kB + per-room cap
- CSRF: `sameSite: 'lax'` + `secure: true` in prod (inherited from pre-audit; verified)
- Every CDN asset has SRI; QR never leaves the client
- Rate limits: login 5/10min, register 10/hr, scan 30/min/student (IPv6-safe), enrol 20/10min, sensitive-auth 10/10min, global 200/min
- `unhandled rejection` + `SIGTERM` + `SIGINT` + `uncaughtException` handlers all graceful-shutdown
- DB CHECK constraints on every enum make raw-SQL bypass impossible

### Data consistency posture

- `createCourse`, `overrideAttendance`, `verifyEmail` all transactional
- Audit log written AFTER attendance commits (with distinct reason codes for UNIQUE violations and other insert errors)
- Warning-log "at most one open crossing" enforced by partial unique index + `INSERT ... ON CONFLICT DO NOTHING`
- Email sent AFTER claim; claim DELETED if email fails (retryable on next threshold crossing)
- Kuwait-local session times stored as correct UTC instants independent of server TZ

### Operational posture

- Graceful shutdown wired (15 s safety timer)
- PG pool: max 25, statement_timeout 15 s
- HTTP: requestTimeout 30 s, headersTimeout 15 s, keepAliveTimeout 65 s
- Expired auth tokens purged every 10 min
- 4 new migrations pending against Neon (0003 enum checks, 0004 warning-log unique, 0005 indexes, 0006 postgis extension)

### Accessibility posture

- Skip link, `role="main"`, `<h1>` on every page, aria-live on live regions, modal focus trap + return, form labels, keyboard tabs, keyboard map placement, `aria-busy` on loading buttons, `aria-current` on bottom-nav, `prefers-reduced-motion` honored

### Known NOT-fixed (color contrast, form error summary, FK cascade, BCRYPT rounds, multi-instance) — see §7

---

## 6. Deployment Checklist

### 1. Apply migrations to Neon (IN ORDER, BEFORE the new code starts)

```bash
psql "$PROD_DATABASE_URL" -f drizzle/0003_enum_checks.sql
psql "$PROD_DATABASE_URL" -f drizzle/0004_warning_log_unique_open.sql
psql "$PROD_DATABASE_URL" -f drizzle/0005_missing_indexes.sql
psql "$PROD_DATABASE_URL" -f drizzle/0006_postgres_extensions.sql
```

All four are additive + idempotent (`IF NOT EXISTS` / `IF EXISTS` on each constraint/index/extension). No downtime required. Rollback scripts are committed alongside as `_rollback.sql`.

### 2. Render environment variables

| Var | Required? | Notes |
|---|---|---|
| `SESSION_SECRET` | Yes | Server crashes on start if it's `change-me` or `change-me-in-production` |
| `ALLOWED_ORIGIN` | Yes (new) | Set to `https://qrguard.strat-os.net`. Without it CORS + Socket.IO fall back to localhost |
| `RESEND_API_KEY` | Conditional (new) | Required when `EMAIL_PROVIDER=resend` |
| `EMAIL_PROVIDER` | Recommended | Currently `console` in `render.yaml`. Flip to `resend` AFTER populating `RESEND_API_KEY` |
| `PG_POOL_MAX` | Optional | Defaults to 25 |

### 3. Smoke tests after deploy

- `GET /login.html` → 200
- `GET /api/auth/me` (no cookie) → 401
- Instructor starts a session: QR renders; DevTools Network tab shows NO request to `api.qrserver.com`
- Attempt to `POST /api/auth/register` with `{"role":"instructor","employeeId":"X",...}` → 201 but the created row is `role='student'` with no instructor entry
- `kill -TERM` on the Node process logs "Shutting down gracefully"

---

## 7. Deferred Decisions (10 items — each awaits a product/infra call, NOT more code)

Deferred explicitly with reason recorded, so future sessions don't re-litigate.

1. **Multi-instance readiness (P2-1..4)** — `activeLoops` Map, rate-limit store, orphan cleanup all assume single instance. Fix = Redis for rate limiter + leader-elected QR scheduler, OR declare "single instance forever".
2. **Retention for `audit_log` / `warning_email_log` / old `sessions`** — need a "keep for how long?" decision and a cron strategy. (Expired tokens are purged; that was the safe subset.)
3. **`BCRYPT_ROUNDS` 12 → 11** — saves ~125 ms per login; still above OWASP minimum. Latency vs strength trade-off.
4. **Async queue for threshold emails** — moves `sendEmail` off the scan request path. Infra decision (BullMQ+Redis, or lightweight in-proc).
5. **Gold `#D4A037` on white = 2.79:1** — fails WCAG AA. Changing brand accent tokens touches every gold surface. AUK design decision.
6. **Form error summary** — aggregated error region + per-field `aria-invalid`/`aria-describedby`. Bigger UX scope; dedicated a11y pass.
7. **FK cascade chain** — `courses.instructor_id`, `attendance.session_id`, `attendance.student_id`, `audit_log.actor_id` all `ON DELETE NO ACTION`, conflicting with `users → instructors ON DELETE CASCADE`. Can't delete a user or an instructor who ever owned a course. Needs per-table policy.
8. **`EMAIL_PROVIDER=resend` flip in `render.yaml`** — until the Render dashboard has `RESEND_API_KEY` populated. One-line change in `render.yaml` afterward.
9. **QR-scanner manual-code fallback** — new feature. Blind students currently can't scan; short-term workaround is instructor showing a 6-char code alongside the QR.
10. **ip-api.com quota / latency** — free tier is 45 req/min per source IP; a 180-student lecture exhausts in ~1 min and every subsequent scan stalls the 3 s AbortController. Options: in-memory cache, paid tier, or self-host MaxMind GeoLite.

---

## 8. Rollback

### Full rollback to pre-audit state

```bash
git reset --hard pre-audit-remediation-20260418-0645
psql "$PROD_DATABASE_URL" -f drizzle/0005_missing_indexes_rollback.sql
psql "$PROD_DATABASE_URL" -f drizzle/0004_warning_log_unique_open_rollback.sql
psql "$PROD_DATABASE_URL" -f drizzle/0003_enum_checks_rollback.sql
# (0006 postgis extension — leave in place; dropping would break geofence)
```

### Per-session rollback

- `git reset --hard pre-p1-remediation-20260418-1900` (keeps P0)
- `git reset --hard pre-p2-remediation-20260418-1920` (keeps P0 + P1)
- `git reset --hard pre-p3-remediation-20260418-2250` (keeps P0 + P1 + P2)

### Single-commit revert (surgical)

```bash
git revert <sha>
```

Every commit is independent; revert newest-first when the same file is touched multiple times (e.g. `auth-controller.js` was edited by P0-1, P0-6, P0-7, P2-9).

### Backup tags on origin

- `pre-audit-remediation-20260418-0645` — before any remediation
- `pre-p1-remediation-20260418-1900` — before P1
- `pre-p2-remediation-20260418-1920` — before P2
- `pre-p3-remediation-20260418-2250` — before Batch J/K

---

## 9. Validation Baseline at HEAD

- `npm test` → **43/43 pass**, 4.8 s
- `npm run lint` → clean (no output)
- `node --check` on every touched backend .js → clean
- End-to-end smoke (local server on port 3077): static 200, unauth API 401, instructor self-register blocked, raw-SQL enum bypass rejected by DB, QR page 0 × `api.qrserver.com` + 2 × SRI, SIGTERM clean exit
- `npm ls esbuild` shows 4 moderate dev-only vulns via `drizzle-kit → @esbuild-kit/*` (prod tree is clean)

---

## 10. Files That Matter

| Purpose | File |
|---|---|
| Project instructions | `CLAUDE.md` |
| Codebase index | `docs/CODEBASE_MAP.md` |
| Schema authoritative reference | `docs/SCHEMA.md` |
| Original build narrative (pre-audit) | `docs/SESSION_REPORT_FULL.md` |
| Audit findings (13 files, 325 KB) | `docs/audit/AUDIT_01..13.md` |
| Master triage | `docs/audit/UNIFIED_REMEDIATION_PLAN.md` |
| P0 outcome | `docs/audit/REMEDIATION_SUMMARY.md` |
| P1 outcome | `docs/audit/P1_REMEDIATION_SUMMARY.md` |
| P2 outcome | `docs/audit/P2_REMEDIATION_SUMMARY.md` |
| Aggregate of all 4 sessions | `docs/audit/REMEDIATION_FINAL.md` |
| **This file** (single-paste context) | `docs/SESSION_REPORT_AUDIT.md` |

For a new Claude session picking up this project: paste this file. It's self-contained and points at the deeper references by path.
