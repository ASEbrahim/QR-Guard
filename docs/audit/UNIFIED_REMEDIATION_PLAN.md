# QR-Guard — Unified Remediation Plan

**Audit date:** 2026-04-18
**Audit scope:** 13 parallel category audits on top of 8 prior audit passes (SESSION_REPORT_FULL.md, 65 fixes already applied)
**Target:** `/home/ahmad/Downloads/csis/QR-Guard` — Node + Express + PostgreSQL + PostGIS attendance system, deployed at https://qrguard.strat-os.net
**Methodology:** StratOS 13-category audit (AUDIT_01 through AUDIT_13). No code changes. Findings only.

---

## Aggregate Findings Count

| Category | Findings | Critical | High | Medium | Low / Info |
|---|---:|---:|---:|---:|---:|
| AUDIT_01 Big O Complexity | 15 | 0 | 3 | 7 | 5 |
| AUDIT_02 Concurrency | 11 | 1 | 4 | 4 | 2 |
| AUDIT_03 SQL Injection | 0 (+2 info) | 0 | 0 | 0 | 2 |
| AUDIT_04 Dead Code | ~10 | 0 | 0 | 2 | 8 |
| AUDIT_05 Error Propagation | 27 | 2 | 8 | 13 | 4 |
| AUDIT_06 Auth Boundaries | 12 | 1 | 2 | 3 | 6 |
| AUDIT_07 Data Consistency | 23 | 3 | 7 | 9 | 4 |
| AUDIT_08 Configuration Drift | 20 | 0 | 4 | 6 | 10 |
| AUDIT_09 Memory Leaks | 9 | 0 | 2 | 4 | 3 |
| AUDIT_10 Dependencies | 10 | 0 | 2 | 5 | 3 |
| AUDIT_11 Resource Exhaustion | 22 | 0 | 0 | 10 | 12 |
| AUDIT_12 Latency Profiling | 17 | 0 | 3 | 9 | 5 |
| AUDIT_13 Accessibility | 60 | 0 | 6 | 25 | 29 |
| **TOTAL (new, non-duplicate)** | **≈236** | **7** | **41** | **97** | **91** |

Prior audits (SESSION_REPORT_FULL.md): 77 findings, 65 fixed. This pass surfaces findings those audits missed or deferred. SQL-injection posture remains strong; the majority of new findings concentrate in data consistency, error propagation, and accessibility.

---

## Cross-Audit Corroborations (Same Bug Seen by Multiple Agents)

These are the strongest findings — independently flagged by 2+ categories:

| Bug | Seen by | Severity |
|---|---|---|
| **Instructor self-registration via `role` in request body** | AUDIT_06 F-01 (Critical), AUDIT_08 D10 (Medium) | **CRITICAL** |
| **`audit_log_target_idx` claimed in docs but does not exist** | AUDIT_01 F-02 (High), AUDIT_07 F (Med), AUDIT_08 D2 (High), AUDIT_12 L-06 (High) | **HIGH** |
| **Audit-log-before-attendance ordering (success row can exist without attendance)** | AUDIT_05 F (Critical), AUDIT_07 F (Critical) | **CRITICAL** |
| **Override has 3 writes without a transaction** | AUDIT_02 F-02, AUDIT_05 (High), AUDIT_07 (High) | **HIGH** |
| **No `unhandledRejection`/`uncaughtException`/`SIGTERM` handlers** | AUDIT_05 (Critical), AUDIT_09 H1 (High) | **CRITICAL** |
| **Multi-instance deployment landmines (activeLoops Map, orphan-cleanup kills peer sessions)** | AUDIT_02 F-04/F-05, AUDIT_07 (session start race) | **HIGH** (latent — single-instance today) |

---

## P0 — Fix Before Next Deploy (Critical / Security-Impacting)

| # | Finding | Ref | File:Line | Effort |
|---|---|---|---|---|
| **P0-1** | **Instructor self-registration.** `register` endpoint accepts `role` from the body; any `@auk.edu.kw` signup can choose `instructor`, create courses, override attendance. Strip `role` from Zod input; force student role server-side. Instructor accounts only via seed script. | AUDIT_06 F-01, AUDIT_08 D10 | `src/backend/controllers/auth-controller.js:28` | ~10 min |
| **P0-2** | **QR tokens leaked to third-party.** `instructor/session.html` renders QR via `https://api.qrserver.com/v1/create-qr-code/?data=<signed-token>`. Every QR refresh (every 25s) transmits a valid, time-limited scan-authorization token to an external service that can log/replay. Add the `qrcode` npm dep back (client-side) or render server-side. | AUDIT_10 F-5 | `src/frontend/instructor/session.html` (QR img src) | ~30 min |
| **P0-3** | **`SESSION_SECRET` guard mismatch.** Guard at `server.js:41` checks for string `'change-me'` but `.env.example` template is `'change-me-in-production'`. Copy-paste deploys bypass the crash-on-default. | AUDIT_08 D5 | `src/backend/server.js:41` | 2 min |
| **P0-4** | **Audit-log ordering inversion.** `scan-verifier.js` writes `audit_log{result:'success'}` in `finally` **before** `scan-controller.js` inserts the attendance row. Any non-UNIQUE-violation error on attendance insert leaves an orphan "success" audit and no attendance. Move audit-insert to after attendance-insert or wrap both in a single transaction. | AUDIT_05, AUDIT_07 | `src/backend/validators/scan-verifier.js:55-72`, `src/backend/controllers/scan-controller.js:47-63` | ~1 hr |
| **P0-5** | **No unhandled rejection / SIGTERM handlers.** Node 20 defaults to crash-on-unhandled-rejection. Any async Socket.IO listener throw (e.g. DB hiccup in `join-session`) → process exit → every live session dropped with no QR-loop cleanup, no `pool.end()`. Wire `process.on('SIGTERM'/'SIGINT'/'unhandledRejection'/'uncaughtException')` with `server.close()` + clear all intervals + `pool.end()` + `io.close()`. | AUDIT_05, AUDIT_09 H1 | `src/backend/server.js:104` (discarded interval handle) | ~1 hr |
| **P0-6** | **Reset-password does not invalidate sessions.** Any cookies an attacker already stole on the victim's device stay valid after a victim-triggered password reset. Call `req.sessionStore.destroy` for all rows matching user ID, or rotate a session version counter. | AUDIT_06 F-02 | `src/backend/controllers/auth-controller.js` (`resetPassword`) | ~1 hr |
| **P0-7** | **Reset-password = lockout bypass.** `resetPassword` unconditionally zeroes `failedLoginCount` and `lockedUntil`, so any attacker who hits lockout can reset instead (and if #P0-1 applies, they're resetting the victim's account from any `@auk.edu.kw` they just registered). Preserve lockout across reset or require re-verification. | AUDIT_06 F-03 | `src/backend/controllers/auth-controller.js` (`resetPassword`) | ~30 min |
| **P0-8** | **Zero DB-level CHECK constraints for enums.** role/status/event_type/result/purpose enforced only in Drizzle TS. Any `db.execute(sql\`...\`)` path bypasses them. Add `CHECK (status IN (...))` etc. in a migration. | AUDIT_07 | `drizzle/*.sql` (missing), `src/backend/db/schema/*.schema.js` (text columns) | ~2 hr |

**P0 total effort: ~6-7 hours.**

---

## P1 — High Priority (Fix Within 1-2 Sprints)

### Security / Auth

| # | Finding | Ref | File:Line |
|---|---|---|---|
| P1-1 | **IDOR on `getPerStudentReport` instructor branch.** Doesn't verify `:studentId` is enrolled in `:id`. Leaks student name + university ID for any UUID. | AUDIT_06 F-06 | `src/backend/controllers/report-controller.js` |
| P1-2 | **Override allows arbitrary student UUID.** `POST /api/sessions/:id/override` body `studentId` not verified to be enrolled. Inserts spurious attendance rows. | AUDIT_06 F-05 | `src/backend/controllers/override-controller.js` |
| P1-3 | **Rebind via `verify-email` doesn't kill old sessions; token leaks via URL query.** | AUDIT_06 F-04 | `src/backend/controllers/auth-controller.js` |
| P1-4 | **Enrollment endpoint not rate-limited.** 6-char code × 31-char alphabet = ~887M combos; brute-forceable at global 200/min = 147 days p50 per course, but still worth per-endpoint throttle. | AUDIT_11 | `src/backend/routes/course-routes.js` (enroll) |
| P1-5 | **Rate-limit gaps** on `reset-password`, `verify-email`, `verify-rebind`, `request-rebind` (global-only 200/min). | AUDIT_11 | `src/backend/routes/auth-routes.js` |

### Data Consistency

| # | Finding | Ref | File:Line |
|---|---|---|---|
| P1-6 | **FK cascade chain broken.** `courses.instructor_id`, `attendance.session_id`, `attendance.student_id`, `audit_log.actor_id` all `ON DELETE no action`; conflicts with `users→instructors ON DELETE cascade` — no working path to delete an instructor or a student with attendance. Decide policy (restrict / set null / cascade) per table and write a migration. | AUDIT_07 | `drizzle/0000_*.sql:75`, `drizzle/0001_*.sql:35-37` |
| P1-7 | **`createCourse` multi-write without transaction.** Course + sessions inserts can half-succeed. | AUDIT_07 | `src/backend/controllers/course-controller.js:113,142` |
| P1-8 | **`overrideAttendance` without transaction** (existence-check + upsert + audit + threshold check). | AUDIT_02, AUDIT_05, AUDIT_07 | `src/backend/controllers/override-controller.js:37-77` |
| P1-9 | **Duplicate warning-email bug.** `warning_email_log` PK includes `crossed_below_at` timestamp; concurrent `checkThresholdAndNotify` calls both INSERT because `new Date()` differs by ms, defeating "one-per-crossing". Use a unique constraint on `(course_id, student_id)` WHERE `recovered_above_at IS NULL` instead. | AUDIT_02 F-3 | `src/backend/services/notification-service.js`, `warning-email-log.schema.js` |
| P1-10 | **`warning_email_log` insert before email send.** Row committed before `sendEmail` — silent loss of warning if email provider errors. Send first, log on success (or queue). | AUDIT_05 | `src/backend/services/notification-service.js:46-77` |
| P1-11 | **Session-generator timezone drift.** `new Date(semesterStart)` parses as UTC midnight; times set with local-TZ `setHours`. On UTC-deployed server (Render US East Ohio) every Kuwait-local class time is inserted off by 3 hours. | AUDIT_07 | `src/backend/services/session-generator.js:29` |
| P1-12 | **`updateCourse` skips geofence Zod validation** (unlike `createCourse`); WKT is parameter-bound so not SQLi, but allows invalid coords into geofence. | AUDIT_03 INFO-1 | `src/backend/controllers/course-controller.js:234-243` |

### Performance

| # | Finding | Ref | File:Line |
|---|---|---|---|
| P1-13 | **Create the missing `audit_log_target_idx`.** Claimed in docs × 4, absent in schema and migrations. `getAuditLog` full-scans. | AUDIT_01 F-02, AUDIT_07, AUDIT_08 D2, AUDIT_12 L-06 | `src/backend/db/schema/audit-log.schema.js:16-19`, `drizzle/` |
| P1-14 | **Add `courses_instructor_idx`.** Also documented as fixed in SCHEMA.md but absent. | AUDIT_08 D3, AUDIT_12 L-03 | `src/backend/db/schema/course.schema.js`, `drizzle/` |
| P1-15 | **`enrollments` composite PK `(course_id, student_id)`** cannot serve student_id-only queries → seq scan in Socket.IO join, `getMyAttendance`, `listCourses` student path. Add a non-PK index on `student_id` alone. | AUDIT_12 L-04 | `src/backend/db/schema/enrollment.schema.js` |
| P1-16 | **Scan hot path: 3-way JOIN per scan** for live counter. Replace with in-memory `Map<sessionId, count>` (single-instance only — see P2-1). | AUDIT_01 F-05 | `src/backend/controllers/scan-controller.js:67-80` |
| P1-17 | **`checkThresholdAndNotify` recomputes full attendance CTE on every scan and every override.** Incrementalize or debounce. | AUDIT_01 F-06, AUDIT_05, AUDIT_12 L-12 | `src/backend/services/notification-service.js` |
| P1-18 | **`getMyAttendance` N+1** — per-course `calculateAttendancePct` calls. Prior-audit "N+1 fixed" applied only to `getPerSessionReport` and `exportCsv`. | AUDIT_01 F-01, AUDIT_12 L-11 | `src/backend/controllers/report-controller.js` |
| P1-19 | **`ip-api.com` latency and quota.** 3s AbortController = p99 scan latency of ~3.9s when upstream is slow. Free tier 45 req/min per source IP → a 180-student lecture exhausts quota in ~1 minute and every subsequent scan stalls the full timeout. Cache by IP for the session, or move to paid tier, or proxy via server. | AUDIT_12 L-08 | `src/backend/validators/ip-validator.js` |

### Operations

| # | Finding | Ref | File:Line |
|---|---|---|---|
| P1-20 | **`ALLOWED_ORIGIN` missing from `.env.example` / `render.yaml`.** Fresh deploys fall through to `http://localhost:3000` for CORS and Socket.IO. | AUDIT_08 D1 | `.env.example`, `render.yaml` |
| P1-21 | **`render.yaml` pins `EMAIL_PROVIDER=console` in production.** | AUDIT_08 D6 | `render.yaml` |
| P1-22 | **Missing `CREATE EXTENSION "uuid-ossp"/"postgis"`** in migrations. Works on Neon by accident (both pre-enabled), breaks local Postgres per README. | AUDIT_08 D4 | `drizzle/` |
| P1-23 | **No PG `statement_timeout`** on the pool. A slow or poisoned query blocks a pool connection forever. | AUDIT_11 | `src/backend/config/database.js` |
| P1-24 | **No HTTP `requestTimeout` / `headersTimeout` / `keepAliveTimeout`** on `http.createServer`. | AUDIT_11 | `src/backend/server.js:96` |
| P1-25 | **`pg.Pool` default max=10** insufficient for lecture-start burst (180 students × 9 RTs). Raise to 20–30 on Neon, or queue scans. | AUDIT_12 L-13 | `src/backend/config/database.js` |
| P1-26 | **CDN assets without SRI integrity hashes** (Leaflet CSS+JS, socket.io client 4.7.5, html5-qrcode 2.3.8, **FingerprintJS v4 — floating major version, security-critical anti-fraud layer**). Pin versions and add `integrity=` + `crossorigin=`. | AUDIT_10 | `src/frontend/**/*.html` |
| P1-27 | **socket.io version drift:** server `4.8.3` vs client CDN `4.7.5`. Pin to matching versions. | AUDIT_10 | server package.json / frontend html |

### Accessibility (High-Impact)

| # | Finding | Ref | File:Line |
|---|---|---|---|
| P1-28 | **Skip-to-content link points to `#main-content` but no page has that id.** Prior "fix" is a dead anchor. Add `id="main-content"` to main container on every page AND fix `renderNavWithBack()` to inject the skip link (currently only `renderNav()` does). | AUDIT_13 | `src/frontend/scripts/components.js:14`, all HTML pages |
| P1-29 | **QR scanner has no manual-code-entry fallback** — app unusable for blind students (WCAG 1.1.1). Add a text input that accepts the QR payload string. | AUDIT_13 | `src/frontend/student/scan.html` |
| P1-30 | **Attendance counter / scan result update without `aria-live`.** Silent to screen readers. | AUDIT_13 | `src/frontend/instructor/session.html:120,168`, `student/scan.html:200-219` |
| P1-31 | **Bottom-sheet modals: no focus move-in, no trap, no return, no `inert` on background.** | AUDIT_13 | `src/frontend/instructor/course.html`, `student/dashboard.html` |
| P1-32 | **Course-create form labels lack `for=` attributes.** Inputs have no accessible name. | AUDIT_13 | `src/frontend/instructor/dashboard.html:24-52` |
| P1-33 | **Leaflet geofence map needs keyboard equivalent for click-to-place.** | AUDIT_13 | `src/frontend/instructor/dashboard.html` |

---

## P2 — Medium Priority (Next Quarter)

### Concurrency / Multi-Instance Readiness

When/if the app scales to >1 Render instance, these all surface as correctness bugs:

- **P2-1** — `activeLoops` Map + Socket.IO rooms partitioned per instance (AUDIT_02 F-4/F-5). Move QR loops to a leader-elected scheduler or accept single-instance constraint explicitly.
- **P2-2** — The unconditional "close all active sessions" cleanup at `server.js:108` will terminate peer instances' active sessions on restart. Scope by host/pid or drop on scale-out.
- **P2-3** — Rate-limiter uses in-memory store; per-instance counters. Move to Redis or accept.
- **P2-4** — `qr-service.js` refresh loop lives in an in-memory Map; multi-worker = duplicate QR loops.

### Error Handling

- **P2-5** — Socket.IO `join-session` handler is async + awaits DB with no try/catch → unhandled rejection on DB hiccup.
- **P2-6** — `scan.html` / `session.html` call `res.json()` before checking `res.ok` → hang on 502.
- **P2-7** — `qr-service.js:18-20` silent fallback to `(0,0)` on malformed WKT.
- **P2-8** — Global error handler has no request context (url/user/method) in logs.
- **P2-9** — Zod error shape inconsistent (first-issue-only vs multiple).

### Memory / Cleanup

- **P2-10** — html5-qrcode camera stream leaks on page navigation (only stopped on successful decode). Add `pagehide`/`beforeunload` handler.
- **P2-11** — `instructor/session.html` socket.io client + polling interval: no teardown on page hide.
- **P2-12** — Leaflet map never `.remove()`d on page navigation.
- **P2-13** — `clearTimeout` in `ip-validator.js` should be in `finally` not after `fetch`.

### Resource Limits

- **P2-14** — No Socket.IO `maxHttpBufferSize` override (default 1 MB) or per-user/IP socket cap.
- **P2-15** — CSV export unbounded; accepts optional `from`/`to` filters, builds full string synchronously with `csv-stringify/sync`. Add required date range or row cap.
- **P2-16** — No retention/archival for `audit_log`, `email_verification_tokens` (expired never purged), `warning_email_log`, old-semester `sessions`.
- **P2-17** — `weeklySchedule` Zod array missing `.max()`; semester length unbounded → a single request can insert thousands of session rows.
- **P2-18** — Scan limiter is IP-global (60/min), not per-student; a NAT'd classroom shares the counter.

### Performance (p50/p99 improvements)

- **P2-19** — Sequential-when-parallelizable queries in `getCourse`, `getAuditLog`, `getPerStudentReport`, `startSession`, `stopSession`, `getQr` (~30 ms each saved with `Promise.all`).
- **P2-20** — `calculateAllAttendancePcts` CROSS JOIN materializes n×m rows.
- **P2-21** — `BCRYPT_ROUNDS=12` → 11 saves ~125 ms on login/register/reset (acceptable tradeoff per OWASP).
- **P2-22** — Email + threshold-check synchronous inside scan thread; queue both.

### Accessibility (Medium)

- **P2-23** — Gold `#D4A037` on white = 2.79:1 contrast (fails AA); `--text-muted #64748b` on `#f4ecdb` = 3.66:1; `--warning #d97706` and `--success #16a34a` on white both fail. Adjust tokens.
- **P2-24** — `prefers-reduced-motion` never respected; 8+ animations run unconditionally.
- **P2-25** — Password toggle buttons lack `aria-pressed` / `aria-label`.
- **P2-26** — `course.html`, `session.html`, `scan.html` have no `<h1>`.
- **P2-27** — No `<main>` landmark anywhere.
- **P2-28** — Tab widget missing `aria-controls`/`aria-labelledby` + arrow-key nav.
- **P2-29** — No form error summary; no per-field `aria-invalid`/`aria-describedby`.
- **P2-30** — `.btn.loading` lacks `aria-busy`.

---

## P3 — Low Priority / Cleanup

- **P3-1** — Remove dead code: `apiPut`, `showSkeletons` exports; email-service `email_verify` branch (if decision is to remove the verification link path); 16 unused CSS selectors (~110 lines). (AUDIT_04)
- **P3-2** — Correct email-service docstring — it claims three modes; only `console` and `resend` are implemented; setting `EMAIL_PROVIDER=smtp` silently degrades. (AUDIT_04)
- **P3-3** — Documentation drift: FRS v1.1 still documents Vercel+Railway, email-link verify, login-time device binding. (AUDIT_08 D9 — already tracked in DOCUMENT_UPDATE_INSTRUCTIONS.md)
- **P3-4** — 404-vs-403 disclosure oracle on session/course/report endpoints (AUDIT_06 F-07).
- **P3-5** — `requestRebind` inline role check drifts from `requireRole` style (AUDIT_06 F-08).
- **P3-6** — 403 body discloses role name (AUDIT_06).
- **P3-7** — Socket.IO room-cap off-by-one (AUDIT_06).
- **P3-8** — Dev-mode limiter bypass `skip: () => isDev` — add a prod-config assertion that `NODE_ENV === 'production'`. (AUDIT_11)
- **P3-9** — `.gitignore` missing `test-results/` (AUDIT_08 D15).
- **P3-10** — Dependency count disagrees across three docs (AUDIT_08 D16).
- **P3-11** — README stack table under-populated (AUDIT_08 D19).
- **P3-12** — `seed.js` / `screenshot-*.js` hardcode port 3001 while server defaults to 3000; no npm script (AUDIT_08 D7/D8).
- **P3-13** — `SCHEMA.md` `courses` table omits `semester_start/_end` columns (AUDIT_08 D13).
- **P3-14** — `SCHEMA.md` reason-code list misses `gps_accuracy_failed`/`course_not_found` (AUDIT_08 D14).
- **P3-15** — Schema column defaults duplicate `constants.js` values (AUDIT_08 D11).
- **P3-16** — `showStatus()` uses `innerHTML =` + `addEventListener` — benign but fragile pattern (AUDIT_09 M4).
- **P3-17** — `getCurrentPosition` with highAccuracy can outlive navigation and fire into frozen pages (AUDIT_09 M3).
- **P3-18** — Socket.IO `disconnect` polling interval overlap window with reconnect (AUDIT_02 F-6).
- **P3-19** — Prior QR tokens stay valid until individual TTL after new issuance — short overlap window (AUDIT_02 F-7).
- **P3-20** — `npm audit` reports 4 moderate (dev-only) vulns via `drizzle-kit → @esbuild-kit/* → esbuild ≤ 0.24.2`. Dev-only impact; revisit when drizzle-kit upstream drops the dep. Consider an `overrides` pin. (AUDIT_10)
- **P3-21** — Nominatim autocomplete fires per keystroke — violates OSM ToS (1 req/sec). Debounce. (AUDIT_10)
- **P3-22** — 29 additional accessibility Low items — see AUDIT_13_ACCESSIBILITY.md.

---

## Recommended Remediation Sequence

### Week 1 — Security hotfixes (P0)
Ship all 8 P0 items in one hardening PR. This closes the instructor self-registration hole, the QR-token leak to `api.qrserver.com`, the session-survives-password-reset issue, the audit-log inversion, and wires graceful shutdown. Adds one migration (CHECK constraints + missing indexes from P1-13/14/15 opportunistically). ~1 day of work.

### Week 2 — Data integrity + performance migration (P1 data/perf)
Second migration: FK cascade policy decision, transactions on override/createCourse, enrollment index, timezone fix, warning-email-log PK change. Add rate limits on reset/verify/rebind/enroll. Pool sizing + PG statement timeout. ~2 days.

### Week 3 — Accessibility sprint (P1 a11y)
Fix skip link, add manual QR entry, aria-live on counters, focus management on modals, form label associations, keyboard map placement. One focused day plus testing with a screen reader. ~2 days.

### Week 4 — Operational hardening (P2)
Retention jobs, Socket.IO hardening, CSV bounding, error-handler context, async queueing of notifications. Decide on multi-instance posture (single-instance forever → document; scale-out → P2-1 through P2-4).

### Opportunistic — Low priority (P3)
Fold into subsequent PRs as touched.

---

## What is NOT in Scope for This Plan

- Prior-audit fixes already applied (65 items in SESSION_REPORT_FULL.md). Confirmed still in place where verified.
- Documentation regeneration (FRS v2.0, PR2, PPTX) — already tracked in `DOCUMENT_UPDATE_INSTRUCTIONS.md`.
- Infrastructure posture (Render free tier, Neon free tier, ip-api.com free tier) — called out where it affects correctness (P1-19 ip-api quota, P1-25 pool sizing, P2-1 multi-instance) but not re-negotiated here.

---

## Per-Audit Detail Reports

Full writeups with root cause, proof, and recommended fix per finding:

- `AUDIT_01_BIG_O_COMPLEXITY.md` — 15 findings
- `AUDIT_02_CONCURRENCY.md` — 11 findings
- `AUDIT_03_SQL_INJECTION.md` — 0 exploitable + 2 info
- `AUDIT_04_DEAD_CODE.md` — ~140 removable lines
- `AUDIT_05_ERROR_PROPAGATION.md` — 27 findings
- `AUDIT_06_AUTH_BOUNDARIES.md` — 12 findings + full 34-endpoint matrix
- `AUDIT_07_DATA_CONSISTENCY.md` — 23 findings
- `AUDIT_08_CONFIGURATION_DRIFT.md` — 20 drifts
- `AUDIT_09_MEMORY_LEAKS.md` — 9 findings
- `AUDIT_10_DEPENDENCIES.md` — 4 dev vulns + CDN/SRI findings
- `AUDIT_11_RESOURCE_EXHAUSTION.md` — 22 findings
- `AUDIT_12_LATENCY_PROFILING.md` — 17 findings + full endpoint latency table
- `AUDIT_13_ACCESSIBILITY.md` — 60 findings + per-page WCAG matrix

---

## Overall Assessment

**Security posture:** Strong foundation (8 prior audit passes, 29 security vulns closed). Three new security-critical gaps (**P0-1 instructor self-registration**, **P0-2 QR-token third-party leak**, **P0-6/P0-7 reset-password issues**) need immediate fixing — each is a straight-line exploit path that would be trivial for a student to find.

**Correctness posture:** The 6-layer scan pipeline is genuinely well-designed (O(1), good separation, FAIL-OPEN on ip-api is documented). Remaining correctness issues cluster around *multi-write flows without transactions* and *enum validation living only in the application layer*. A single migration fixes both classes.

**Operational readiness:** Weakest area. No graceful shutdown, no retention strategy, no multi-instance readiness, several ops constants (pool size, timeouts, rate-limit coverage) at defaults that don't suit a lecture-hall burst pattern. All P1 items; none block today's usage.

**Documentation integrity:** Moderate drift — 4 audits independently flagged the missing `audit_log_target_idx` that three separate docs claim was added. This is a signal that audit-claim verification (did the fix actually land?) should be part of the commit discipline going forward.

**Accessibility:** Most findings. The prior-audit "fix" (skip link, role=alert, focus ring) was directionally correct but shallow — skip link points to nothing, QR scanner is unusable for blind students, no aria-live on the live counter, no focus management in modals. Fixable in a focused sprint.
