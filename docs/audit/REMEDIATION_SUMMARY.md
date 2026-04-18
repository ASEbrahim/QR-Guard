# QR-Guard — P0 Remediation Summary

**Session date:** 2026-04-18
**Scope:** All 8 P0 items from `UNIFIED_REMEDIATION_PLAN.md`
**Result:** 8 fixes applied across 8 commits. 43/43 tests pass. Lint clean.
**Branch:** `main` — local only, not pushed.
**Backup tag:** `pre-audit-remediation-20260418-0645`

---

## Commits Applied

| # | Ref | Commit SHA | Summary |
|---|---|---|---|
| 1 | P0-3 | `9d1d8ae` | fix(server): SESSION_SECRET guard mismatch with template value |
| 2 | P0-1 | `fcc636e` | fix(auth): prevent instructor self-registration via role in body |
| 3 | P0-7 | `c04cb8d` | fix(auth): reset-password no longer clears lockout state |
| 4 | P0-6 | `abd57b3` | fix(auth): invalidate all sessions on password reset |
| 5 | P0-4 | `e423cf0` | fix(scan): audit success row written after attendance commit |
| 6 | P0-5 | `48135c4` | feat(server): graceful shutdown + unhandled rejection handlers |
| 7 | P0-2 | `e499160` | fix(security): render QR client-side instead of leaking tokens |
| 8 | P0-8 | `ad7710d` | feat(db): CHECK constraints on every enum column |

**Total:** 13 files changed, 545 insertions, 65 deletions.

---

## Validation

### Automated
- `npm test` → **43 / 43 pass** (baseline preserved after every commit, verified 8 times).
- `npm run lint` → clean, no warnings.
- `node --check` on every edited `.js` file → clean.

### Manual smoke tests (against local server on port 3099/3088)

| # | Test | Expected | Actual |
|---|---|---|---|
| A | `POST /register` with `role:"instructor", employeeId:"HACK"` | Creates student, ignores role | ✓ userId returned, DB row is `role=student`, `employee_id=NULL` |
| B | Raw `INSERT INTO users ... role='superadmin'` | Rejected by DB | ✓ `violates check constraint "users_role_check"` |
| C | Raw `INSERT INTO attendance ... status='late'` | Rejected by DB | ✓ `violates check constraint "attendance_status_check"` |
| D | `/instructor/session.html` contains `api.qrserver.com` | No | ✓ 0 occurrences |
| E | `/instructor/session.html` contains SRI hash | Yes (`integrity="sha384-..."`) | ✓ present |
| F | `uncaughtException` path | Logs + graceful shutdown + exit(1) | ✓ `[server] Received uncaughtException. Shutting down gracefully... [server] Shutdown complete.` |
| G | Tests still pass against CHECK-constrained DB | 43/43 | ✓ |

---

## Deployment Checklist

When you (Ahmad) deploy this to `qrguard.strat-os.net`:

### 1. Neon migration — MANUAL STEP REQUIRED

The enum CHECK constraints in `drizzle/0003_enum_checks.sql` are **not auto-applied**. Run before restarting the Render service:

```bash
psql "$PROD_DATABASE_URL" -f drizzle/0003_enum_checks.sql
```

If you ever need to roll it back:

```bash
psql "$PROD_DATABASE_URL" -f drizzle/0003_enum_checks_rollback.sql
```

No data migration is needed — existing rows all comply (verified on local DB).

### 2. Environment variables — verify before deploy

- `SESSION_SECRET` must NOT be `change-me` or `change-me-in-production`. Both are now blocked in prod (server crashes on start if left at default).
- `ALLOWED_ORIGIN` should be set to `https://qrguard.strat-os.net` (already flagged in AUDIT_08 D1 — not fixed in this P0 pass, still pending).
- `EMAIL_PROVIDER=resend` for production (currently `console` in `render.yaml` per AUDIT_08 D6 — not fixed in this pass).

### 3. Frontend cache

- `session.html` changed: new CDN asset (`qrcodejs` 1.0.0), new script order.
- Hard refresh after deploy to pick up the SRI-pinned script.

### 4. Smoke test in production

- Log in as an instructor, start a session, confirm the QR renders and no network request to `api.qrserver.com` is made (check DevTools Network tab).
- Try registering `/api/auth/register` with `{"role":"instructor","employeeId":"x",...}` → should create a student with no instructor row.

---

## Rollback Strategy

### Full rollback (nuclear — reverts all 8 P0 fixes)

```bash
cd /home/ahmad/Downloads/csis/QR-Guard
git reset --hard pre-audit-remediation-20260418-0645
# If 0003 migration was applied to prod:
psql "$PROD_DATABASE_URL" -f drizzle/0003_enum_checks_rollback.sql
```

### Single-fix rollback (surgical — revert one fix, keep the rest)

```bash
git revert <sha>
# E.g. to roll back only the client-side QR change:
git revert e499160
```

Each commit is independent — revert order matters only for fixes that touch the same file:

- `auth-controller.js` is touched by 3 commits (P0-1, P0-7, P0-6). Revert newest first to avoid conflict.
- `server.js` is touched by 2 commits (P0-3, P0-5). Revert P0-5 before P0-3 if both.
- Everything else touches unique files.

---

## What's Still Open (Not In This Pass)

The **UNIFIED_REMEDIATION_PLAN.md** lists 41 P1, 97 P2, and 91 P3 items that remain. Highlights:

- **P1** — FK cascade policy (broken chain), transactions on override/createCourse, missing `audit_log_target_idx`, `ALLOWED_ORIGIN` / `EMAIL_PROVIDER` config drift, CDN SRI hardening for Leaflet/socket.io/html5-qrcode/FingerprintJS, IP rate-limit gaps, timezone drift in session generator, WCAG AA accessibility (skip link, modal focus trap, manual QR fallback), ip-api.com quota / latency.
- **P2** — Multi-instance readiness, retention/archival for audit_log, camera stream leaks, pool sizing.
- **P3** — Dead code cleanup, doc drift, 404/403 oracle.

Run the P1 work when ready — the same pattern applies (backup tag, per-commit fixes, test after each, final summary).

---

## Files Delivered

- `docs/audit/REMEDIATION_PLAN.md` — the step-by-step plan written before executing (committed in fcc636e).
- `docs/audit/REMEDIATION_SUMMARY.md` — this file, summary of what was done.
- `drizzle/0003_enum_checks.sql` — additive migration (must be applied manually to prod).
- `drizzle/0003_enum_checks_rollback.sql` — rollback script for the migration.
- 13 modified source files across backend / frontend / tests (see git log above).
