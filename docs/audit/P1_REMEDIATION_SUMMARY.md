# QR-Guard — P1 Remediation Summary

**Session date:** 2026-04-18 (follow-up to the P0 pass)
**Scope:** 36 of 41 P1 items from `UNIFIED_REMEDIATION_PLAN.md`
**Result:** 5 batched commits on `main`. 43/43 tests pass. Lint clean.
**Backup tag:** `pre-p1-remediation-20260418-1900`

---

## Commits Applied

| # | Batch | SHA | Items | Summary |
|---|---|---|---|---|
| 1 | A · Security | `5821c21` | P1-1..5 | IDOR close, over-reach close, rebind session invalidation, enroll + sensitive-auth rate limits |
| 2 | B · Data | `45081c6` | P1-7..12 | Transactions on createCourse / override, warning-log concurrency (migration 0004), email-then-log ordering, Kuwait TZ fix, updateCourse Zod |
| 3 | C · Perf | `c7930bd` | P1-13..16, 18 | Three missing indexes (migration 0005), scan counter JOIN flatten, getMyAttendance N+1 → bulk CTE |
| 4 | D · Ops | `7de9266` | P1-20, 22-27 | ALLOWED_ORIGIN in env, `CREATE EXTENSION postgis` (migration 0006), HTTP + PG timeouts, pool max=25, SRI on all CDNs, socket.io 4.8.3 pin |
| 5 | E · A11y | `e961ef5` | P1-28, 30-33 | Working skip link, aria-live regions, modal focus trap, form labels, keyboard equivalent for Leaflet map, reduced-motion support |

**31 files changed, 763 insertions, 218 deletions.**

---

## Validation

- `npm test` → **43/43 pass** after every batch (baseline preserved through all 5 commits)
- `npm run lint` → clean
- `node --check` on every edited `.js` file → clean
- Migrations 0004, 0005, 0006 applied to local DB and verified (partial unique index, 3 new indexes, postgis extension)

**Known gap:** frontend accessibility changes were not tested with an actual screen reader. Skip-link, aria-live, modal focus, and form labels were validated by code inspection. A11y final sign-off should run NVDA or VoiceOver against the live app.

---

## Deferred Items (NOT done in this pass)

### P1-6 — FK cascade chain rewrite
**Why deferred:** needs a per-table decision (RESTRICT / SET NULL / CASCADE) that's a product call, not just a technical fix. Today: `courses.instructor_id`, `attendance.session_id`, `attendance.student_id`, `audit_log.actor_id` are all `ON DELETE NO ACTION`, which conflicts with `users → instructors ON DELETE CASCADE`. Cannot physically delete a user or an instructor who owns courses. Needs an explicit answer to "what happens to attendance rows when a student graduates and is deleted?".

### P1-17 — threshold-check recompute
**Why deferred:** `checkThresholdAndNotify` runs the full attendance CTE on every scan and every override. The fix needs either an incremental counter (new column on enrollments) or a cache — both are bigger refactors than the rest of Batch C.

### P1-19 — ip-api.com quota / latency
**Why deferred:** on a 180-student lecture, a free-tier ip-api account (45 req/min) exhausts its quota in ~1 minute. Options: (a) cache by IP per session, (b) upgrade to paid plan, (c) proxy via server. The product decision of "which" shouldn't be me; it's cost + trust trade-off.

### P1-21 — render.yaml `EMAIL_PROVIDER=console` → `resend`
**Why deferred:** flipping this requires `RESEND_API_KEY` being populated in the Render dashboard (`sync: false`, so I can't set it from here). I added the key to `render.yaml` as a placeholder so it appears in the Render UI; **Ahmad must populate it and change `EMAIL_PROVIDER` to `resend` when ready**. Until then, production still only logs emails to stdout.

### P1-29 — QR-scanner manual-code fallback
**Why deferred:** this is a new feature (a text input accepting QR payload strings), not a fix. Scope + UX deserves its own PR. For accessibility compliance today, the camera permission prompt and html5-qrcode are the only paths — blind students remain blocked from scanning. If quick relief is needed, a pragmatic short-term is: instructor shows the QR payload as a 6-char code too, student types it.

---

## Deployment Checklist

### Migrations to apply (must run BEFORE the new code starts)

```bash
# In order:
psql "$PROD_DATABASE_URL" -f drizzle/0004_warning_log_unique_open.sql
psql "$PROD_DATABASE_URL" -f drizzle/0005_missing_indexes.sql
psql "$PROD_DATABASE_URL" -f drizzle/0006_postgres_extensions.sql
```

All three are additive and idempotent; safe to run against prod data that's compatible with the app-layer behavior already in place.

### Render env vars to confirm / add

- `ALLOWED_ORIGIN` — set to the same value as `BASE_URL` (e.g. `https://qrguard.strat-os.net`). New in `render.yaml`.
- `RESEND_API_KEY` — add the actual Resend key. New in `render.yaml`.
- `EMAIL_PROVIDER` — keep as `console` until `RESEND_API_KEY` is populated. Flip to `resend` when ready.
- `PG_POOL_MAX` — optional; defaults to 25, override if Neon tier needs different.

### Smoke tests after deploy

- Instructor dashboard loads (Leaflet + SRI hash validates; if hash mismatch, check the CDN URL wasn't changed).
- Session page renders QR client-side (no requests to `api.qrserver.com`).
- Scanning succeeds and attendance counter updates (Socket.IO 4.8.3 handshake works).
- Try `POST /api/courses/enroll` with a bad code 21 times in 10 min from the same IP — 21st returns 429.

---

## Rollback

### Per-batch rollback (surgical)

```bash
# Revert a specific batch (newest → oldest; order matters because
# some batches touch the same files as earlier ones).
git revert e961ef5   # Batch E a11y
git revert 7de9266   # Batch D ops
git revert c7930bd   # Batch C perf
git revert 45081c6   # Batch B data
git revert 5821c21   # Batch A security
# And if a DB migration was applied:
psql "$PROD_DATABASE_URL" -f drizzle/0004_warning_log_unique_open_rollback.sql
psql "$PROD_DATABASE_URL" -f drizzle/0005_missing_indexes_rollback.sql
# (0006 postgis extension is kept; DROP EXTENSION would break geofence queries)
```

### Full P1 rollback (nuclear)

```bash
cd /home/ahmad/Downloads/csis/QR-Guard
git reset --hard pre-p1-remediation-20260418-1900
# This keeps the P0 fixes intact. For full pre-remediation state:
# git reset --hard pre-audit-remediation-20260418-0645
```

---

## Remaining Work

From `UNIFIED_REMEDIATION_PLAN.md`:

- **P1:** 5 items deferred (P1-6, P1-17, P1-19, P1-21, P1-29) — each needs a decision or is a new feature.
- **P2:** 97 items. Top priorities: retention / archival for `audit_log`, camera MediaStream leak on page hide, tab widget ARIA (AUDIT_13 medium), `calculateAllAttendancePcts` CROSS JOIN optimization.
- **P3:** 91 cleanup items (dead code, doc drift, 404/403 oracle, minor a11y).

Run P2 when ready; pattern is the same (backup tag, themed batches, tests after each).
