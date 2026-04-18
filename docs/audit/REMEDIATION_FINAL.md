# QR-Guard — Audit Remediation: Final Aggregate

**Scope:** Complete 13-category audit → staged remediation across four sessions.
**Period:** 2026-04-18 (single continuous working day)
**Result:** 23 commits on `main`, 4 DB migrations pending against Neon, 43/43 tests pass at every commit, lint clean.

This document indexes the four session summaries, lists deployment prerequisites, and records every decision that was deferred rather than silently made.

---

## Index

- `comprehensive-audit-*` / `AUDIT_01` through `AUDIT_13.md` — the original 13 findings files (325 KB total)
- `UNIFIED_REMEDIATION_PLAN.md` — the master triage with P0..P3 prioritisation
- `REMEDIATION_PLAN.md` — step-by-step plan used to execute P0 (the "brief" handed to myself before P0)
- `REMEDIATION_SUMMARY.md` — P0 outcome (Apr 18, 06:43 local)
- `P1_REMEDIATION_SUMMARY.md` — P1 outcome (19:17 local)
- `P2_REMEDIATION_SUMMARY.md` — P2 + safe P3 subset outcome (22:42 local)
- **`REMEDIATION_FINAL.md`** — this file; final aggregate including Batch J + K + IPv6 fix

---

## Commit Map (23 total, newest first)

| SHA | Pass | Subject |
|---|---|---|
| `17510a3` | Final | fix(rate-limit): IPv6-safe scan limiter key |
| `48ca886` | P3-K | expired-token retention + SCHEMA.md drift |
| `df45193` | P3-J | error visibility + a11y polish + Nominatim ToS |
| `17e0b2b` | P2 | P2 summary doc |
| `3e95f9d` | P2-I | safe P3 cleanup |
| `f525877` | P2-H | a11y polish (aria-pressed, h1, tabs, aria-busy) |
| `149edc8` | P2-G | limits + perf (socket buffer, CSV cap, scan key, attendance rewrite) |
| `4f316d3` | P2-F | error handling + memory teardown |
| `93a4ae5` | P1 | P1 summary doc |
| `e961ef5` | P1-E | a11y (skip link, aria-live, modal focus, form labels) |
| `7de9266` | P1-D | ops (CDN SRI, pool sizing, timeouts, extensions) |
| `c7930bd` | P1-C | perf (missing indexes + scan JOIN flatten + N+1 fix) |
| `45081c6` | P1-B | data (transactions + warning log + TZ + updateCourse Zod) |
| `5821c21` | P1-A | security (IDOR + over-reach + rate-limit gaps) |
| `1a10747` | P0 | P0 summary doc |
| `ad7710d` | P0-8 | DB CHECK constraints for every enum |
| `e499160` | P0-2 | client-side QR rendering (stop 3rd-party token leak) |
| `48135c4` | P0-5 | graceful shutdown + unhandled rejection handlers |
| `e423cf0` | P0-4 | audit-log after attendance commit |
| `abd57b3` | P0-6 | invalidate all sessions on password reset |
| `c04cb8d` | P0-7 | reset-password no longer clears lockout |
| `fcc636e` | P0-1 | prevent instructor self-registration |
| `9d1d8ae` | P0-3 | SESSION_SECRET guard string mismatch |

**Statistics across the audit → remediation work:**

- ~236 new findings produced by the 13-category audit
- ~110 findings addressed across the four remediation passes (8 P0 + 36 P1 + 21 P2 + ~11 P3 + 2 late catches = Batch J socket/logout/nav a11y and Batch K token retention + the IPv6 limiter fix)
- ~120 findings remaining, documented with rationale or deferred for product decision
- 4 new DB migrations introduced (`0003`, `0004`, `0005`, `0006`) — each with an explicit `_rollback.sql`
- 6 git tags (`pre-audit-remediation-`, `pre-p1-`, `pre-p2-`, `pre-p3-`, plus two prior)
- Backend files touched: 16. Frontend files touched: 10. Docs: 6.
- **43/43 tests pass at every commit. `npm run lint` clean at every commit.**

---

## Deployment Checklist

### 1. Apply migrations against the Neon production DB (IN ORDER, BEFORE Render restarts with the new code)

```bash
psql "$PROD_DATABASE_URL" -f drizzle/0003_enum_checks.sql
psql "$PROD_DATABASE_URL" -f drizzle/0004_warning_log_unique_open.sql
psql "$PROD_DATABASE_URL" -f drizzle/0005_missing_indexes.sql
psql "$PROD_DATABASE_URL" -f drizzle/0006_postgres_extensions.sql
```

All four are additive and idempotent (each uses `IF EXISTS / IF NOT EXISTS`). None require downtime.
If any fail on existing data (they should not — verified locally), investigate before re-running; don't force.

### 2. Confirm / set Render environment variables

| Var | Required? | Notes |
|---|---|---|
| `SESSION_SECRET` | Yes | Must NOT be `change-me` or `change-me-in-production`. Server crashes on start if so (P0-3 guard). |
| `ALLOWED_ORIGIN` | Yes | Set to `https://qrguard.strat-os.net`. New in P1-20. Without this, CORS + Socket.IO fall through to localhost and the frontend can't talk to the API. |
| `RESEND_API_KEY` | Conditional | Required when `EMAIL_PROVIDER=resend`. New in P1-20. |
| `EMAIL_PROVIDER` | Recommended | Currently pinned to `console` in `render.yaml`. Flip to `resend` **after** `RESEND_API_KEY` is populated. |
| `PG_POOL_MAX` | Optional | Defaults to 25 (P1-25). Raise if Neon's connection limit allows; lower if sharing with other apps. |

### 3. Verify after deploy

- `GET /login.html` → 200 (static serving works)
- `GET /api/auth/me` without a cookie → 401 (auth middleware reachable)
- Start an instructor session → QR renders in-browser (DevTools Network tab shows NO request to `api.qrserver.com`)
- Scan attempt with a bad code from a real device → attendance or specific reason code; audit log has a `scan_attempt` row written AFTER the attendance insert (or rejected before it)
- `SIGTERM` via `render deploy` should see "Shutting down gracefully" in logs (P0-5)

---

## Deferred Decisions (what's NOT fixed and why)

Each of these was intentionally left for an explicit decision rather than silently chosen.

### Multi-instance readiness (P2-1..4)
**Fix cost:** Redis (for rate-limit store + leader-elected QR refresh) OR self-imposed "single instance forever" constraint, documented.
**Need from you:** Product call on scale target. Today Render runs a single instance; all four findings are latent.

### Retention beyond expired tokens (P2-16 remainder)
**Done:** expired email-verification-tokens are purged via the existing 10-min `cleanupExpiredTokens` interval (Batch K).
**Not done:** `audit_log`, `warning_email_log`, old-semester `sessions` have no retention. Each needs a "how long do we keep these" decision + a cron strategy (Render cron jobs, in-process interval, external job).
**Need from you:** retention policy (90 days? academic year? forever?).

### BCRYPT_ROUNDS (P2-21)
**Trade-off:** 12 → 11 saves ~125 ms on every login/reset. 11 is still above OWASP minimum (10). Shipping today with 12 is safe.
**Need from you:** "yes, lower to 11" if login latency becomes a complaint.

### Async queue for threshold emails (P2-22)
**Fix cost:** BullMQ + Redis, or a lightweight in-memory queue with retries.
**Impact today:** every scan still synchronously runs `checkThresholdAndNotify` → `sendEmail` on the request path. A slow Resend response blocks the scan response.
**Need from you:** infra decision (matches P2-1..4's Redis question).

### Color contrast — gold `#D4A037` (P2-23)
**WCAG AA fail:** 2.79:1 on white. Also `--text-muted`, `--warning`, `--success` on their backgrounds.
**Need from you:** brand design decision. Any contrast lift would change every gold accent.

### Form error summary (P2-29)
**Scope:** aggregated error-summary regions at the top of forms + per-field `aria-invalid`/`aria-describedby`.
**Decision:** the existing `role="alert"` + aria-live on errors covers the critical announce-on-failure need. A full error-summary pattern is a dedicated a11y pass, not worth snuck into a mixed batch.

### FK cascade chain (P1-6)
**Problem:** `courses.instructor_id`, `attendance.session_id`, `attendance.student_id`, `audit_log.actor_id` are all `ON DELETE NO ACTION`, conflicting with `users → instructors ON DELETE CASCADE`. Can't delete a user or an instructor who ever owned a course.
**Need from you:** per-table policy. "What should happen to attendance rows when a student graduates and their row is deleted?" is the load-bearing question.

### `EMAIL_PROVIDER=resend` in render.yaml (P1-21)
**Not flipped:** until you populate `RESEND_API_KEY` in Render dashboard (the key is marked `sync:false` and can't be set from this repo).
**When ready:** change `render.yaml:14` from `console` to `resend`, commit, deploy.

### QR-scanner manual-code fallback (P1-29)
**Scope:** new feature — blind students currently can't use the scan page. Requires a text input that accepts the QR payload string.
**Short-term workaround:** instructor displays the QR payload as a 6-char code too, student types it. Not a code change.

### Threshold-check recompute (P1-17)
**Scope:** `checkThresholdAndNotify` runs the full attendance CTE on every scan / override. Needs either an incremental counter column on `enrollments`, or a per-course cache keyed on attendance state.
**Decision:** bigger than the P1 batches; left for a dedicated perf pass.

### ip-api.com quota / latency (P1-19)
**Problem:** free-tier ip-api has 45 req/min per source IP. A 180-student lecture exhausts the quota in ~1 minute, and every subsequent scan stalls the full 3 s AbortController timeout (FAIL-OPEN still completes the scan, but slowly).
**Options:** (a) in-memory cache of IP → country keyed per session, (b) upgrade to ip-api Pro, (c) self-host a MaxMind GeoLite lookup.
**Need from you:** cost + operational trust decision.

### P3 cleanup subset
- 5 CSS selectors (`.empty-state`, `.flex-between`, `.mb-1`, `.section-header`, `.stat-value`) — look unused but touch visually-similar siblings. Safer to remove with a browser verification session.
- `email_verify` dead-looking branch in `sendTokenEmail` + `verifyEmail` controller — kept because 4 integration tests exercise it (`auth-flow.test.js`). Need a decision on whether the email-link verification path (beyond 6-digit codes) should remain a fallback.

### Accessibility items beyond what's landed
- Full manual screen-reader audit (NVDA / VoiceOver) has not been run against the live app. The changes from P1 + P2 + Batch J were verified by code inspection only.
- Remaining WCAG AA items concentrate on color contrast (deferred above), error summaries (deferred above), and per-page polish that would benefit from a test-with-a-user-who-relies-on-AT session.

---

## Rollback

### Full rollback to the pre-audit state

```bash
cd /home/ahmad/Downloads/csis/QR-Guard
git reset --hard pre-audit-remediation-20260418-0645
# Drop all DB changes applied via the four migrations:
psql "$PROD_DATABASE_URL" -f drizzle/0006_postgres_extensions.sql  # (postgis: likely keep, depends on Neon setup)
psql "$PROD_DATABASE_URL" -f drizzle/0005_missing_indexes_rollback.sql
psql "$PROD_DATABASE_URL" -f drizzle/0004_warning_log_unique_open_rollback.sql
psql "$PROD_DATABASE_URL" -f drizzle/0003_enum_checks_rollback.sql
```

Note: the `0006_postgres_extensions.sql` migration only issues `CREATE EXTENSION IF NOT EXISTS postgis`. It's not safe to auto-rollback (dropping postgis would break geofence queries). If a rollback is needed, leave postgis in place.

### Rollback to a specific session

```bash
git reset --hard pre-p1-remediation-20260418-1900   # keeps P0
git reset --hard pre-p2-remediation-20260418-1920   # keeps P0 + P1
git reset --hard pre-p3-remediation-20260418-2250   # keeps P0 + P1 + P2
```

### Single-commit revert (surgical)

```bash
git revert <sha>
```

Every commit in the 23-commit trail is independent enough to revert without cascading. For commits that touch the same file (e.g. `auth-controller.js` was touched by P0-1, P0-6, P0-7 and P2-9), revert newest-first to avoid conflicts.

---

## Validation Baseline (against main at `17510a3`)

- `npm test` → 9 test files, 43 tests, all pass. 4.8s.
- `npm run lint` → no output (clean).
- `node --check` on every touched backend `.js` → clean.
- `npm ls esbuild` would show the same 4 dev-only esbuild-kit vulns noted in AUDIT_10; the prod dep tree is clean.
- End-to-end smoke (server on port 3077): static serve 200, unauth API 401, enroll → auth gate 401 (limiter correctly deferred to post-auth), QR page has 0 third-party QR refs + 2 SRI hashes, DB CHECK rejects raw-SQL invalid enum, graceful shutdown on SIGTERM exits cleanly.
- `ipKeyGenerator` warning from express-rate-limit: caught on first boot of the E2E smoke and fixed in `17510a3`. No remaining boot-time validation errors.

---

## What Shipped

**Security**: 7 critical paths closed (instructor self-register, audit-log inversion, QR token leak, session-survives-reset, lockout-via-reset, no graceful shutdown, DB enum bypass). 5 high-impact follow-ons closed (IDOR, override over-reach, rebind session-kill, IPv6 limiter bypass, sensitive-auth rate gaps).

**Correctness**: 3 critical data-consistency holes closed (createCourse + override + warning-log all now transactional; 4 missing indexes promised by docs actually exist; session generator stores UTC instants whose Kuwait wall-clock matches the schedule; QR generation throws on malformed WKT instead of silently emitting bogus coords).

**Operations**: graceful shutdown / unhandled rejection / SIGTERM wired; pool sizing + statement timeout; HTTP request/header/keep-alive timeouts; CDN SRI on every asset; `ALLOWED_ORIGIN` + `RESEND_API_KEY` documented in env templates; retention purge for expired auth tokens.

**Accessibility**: skip-link actually works and points at a real `role="main"` target; aria-live on the live counter and scan result; modal focus trap (course + student sheets); form labels tied to inputs; keyboard equivalent for the Leaflet map; full keyboard tabs widget; password toggle aria-pressed; `aria-busy` on loading buttons; `prefers-reduced-motion` honored; bottom-nav icons marked decorative + `aria-current` on the active page.

**Dead code / drift**: 2 unused JS exports and ~75 lines of unused CSS removed; email-service docstring corrected; SCHEMA.md updated to reflect the new indexes + partial unique index + reason codes actually present.

**What did not ship**: the 10 explicit deferrals above — each preserved for a product or infra decision rather than silently chosen.
