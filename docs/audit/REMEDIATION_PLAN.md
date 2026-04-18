# QR-Guard — P0 Remediation Execution Plan

**Session date:** 2026-04-18
**Scope:** 8 P0 items from UNIFIED_REMEDIATION_PLAN.md (security-critical, deploy-blocking)
**Baseline:** 43/43 tests passing. Backup tag: `pre-audit-remediation-20260418-0645`

---

## Safety / Rollback Strategy

1. **Git tag** `pre-audit-remediation-20260418-0645` created before any changes. Full rollback: `git reset --hard pre-audit-remediation-20260418-0645`.
2. **One commit per fix** — each P0 item is a discrete, reversible commit. Rollback single fix: `git revert <sha>`.
3. **Test after each logical group** — full vitest suite (43 tests, ~5s) gates progress.
4. **Migrations are additive** — new migration file, no edits to existing migrations. Rollback: `DROP CONSTRAINT ... IF EXISTS` script documented below.
5. **No force pushes; no rebases; no `git reset --hard` without user approval.**
6. **No production deploy as part of this work** — local repo changes only. User deploys when ready.

---

## Execution Order (Low-risk → High-risk)

Trivial and isolated fixes first so if a later fix breaks tests we can bisect easily.

| # | Fix | Files touched | Risk | Commit msg |
|---|---|---|---|---|
| 1 | **P0-3** SESSION_SECRET guard string fix | `src/backend/server.js` | Trivial | `fix(server): SESSION_SECRET guard string mismatch` |
| 2 | **P0-1** Strip role from register; student-only | `src/backend/controllers/auth-controller.js`, `tests/integration/auth-flow.test.js` (refactor instructor test) | Medium — test refactor | `fix(auth): prevent instructor self-registration via role in body` |
| 3 | **P0-7** Reset-password preserves lockout counters | `src/backend/controllers/auth-controller.js` | Low | `fix(auth): reset-password no longer clears lockout state` |
| 4 | **P0-6** Reset-password destroys sessions | `src/backend/controllers/auth-controller.js` | Medium — new raw SQL | `fix(auth): invalidate all sessions on password reset` |
| 5 | **P0-4** Audit log after attendance | `src/backend/validators/scan-verifier.js`, `src/backend/controllers/scan-controller.js` | High — hot path | `fix(scan): audit success row after attendance commit` |
| 6 | **P0-5** Graceful shutdown + unhandled handlers | `src/backend/server.js`, `src/backend/services/qr-service.js` | Medium — startup path | `feat(server): graceful shutdown and unhandled rejection handlers` |
| 7 | **P0-2** Client-side QR rendering | `src/frontend/instructor/session.html` | Low-Medium — external lib swap | `fix(security): render QR client-side, stop leaking tokens to third party` |
| 8 | **P0-8** DB CHECK constraints for enums | New `drizzle/0003_enum_checks.sql`, schema `.js` files | Medium — schema change | `feat(db): add CHECK constraints on all enum columns` |

---

## Per-Fix Detail

### #1 — P0-3: SESSION_SECRET guard

**Bug:** `server.js:41` checks `SESSION_SECRET === 'change-me'` but `.env.example` ships `'change-me-in-production'`. Copy-paste deploys bypass the crash.

**Fix:** Change guard to a startsWith check OR expand the literal comparison to both strings. Chosen: list-based check that covers both.

**Rollback:** `git revert <sha>` — single-line change.

**Tests affected:** none directly (NODE_ENV is not 'production' in tests).

---

### #2 — P0-1: Prevent instructor self-registration

**Bug:** `auth-controller.js:28` accepts `role: z.enum(['student', 'instructor'])` from request body. Anyone with an `@auk.edu.kw` email can register as instructor.

**Fix:**
- Zod schema: drop `role` and `employeeId` fields; student-only input.
- Controller: force `role = 'student'`.
- Create student row, never instructor row.
- Instructors stay DB-seeded only (per docs intent).

**Test refactor:** `tests/integration/auth-flow.test.js:131-151` creates an instructor via `POST /register` to verify instructor redirect. Replace with direct DB insert (pattern copied from `scripts/seed.js`). Behavior under test (login → 200 with `/instructor/dashboard.html` redirect) is preserved.

**Rollback:** `git revert <sha>` restores both controller and test.

**Verification:**
- All 43 tests still pass.
- Manual: `POST /register` with `role: 'instructor'` in body → user is still created as student (silently stripped).
- Manual: seeded instructor still logs in correctly.

---

### #3 — P0-7: Reset-password no longer clears lockout

**Bug:** `auth-controller.js:368` in `resetPassword` transaction: `tx.update(users).set({ passwordHash, failedLoginCount: 0, lockedUntil: null })`. This means any attacker who hits the lockout can pivot to the reset flow as a bypass.

**Fix:** Only update `passwordHash`. Lockout remains in place until it expires naturally (30-min auto-unlock per `LOCKOUT_DURATION_MS`). A legitimate locked-out user: either waits 30 min, or resets password AND waits.

**Consideration:** There's a secondary product question — should a successful reset clear `failedLoginCount` (not `lockedUntil`)? Doing so is reasonable UX. But per the audit this is a security-sensitive knob; conservative default is to preserve both. User can flip later if UX complaints materialize.

**Tests affected:** `should reset password via token` (line 205) — verifies reset succeeds with new password. Not affected by this change.

**Rollback:** revert commit.

---

### #4 — P0-6: Reset-password destroys all sessions

**Bug:** `connect-pg-simple` stores sessions in a `session` table with a JSONB `sess` column and a `sid` PK. A victim's stolen cookie stays valid across a password reset because nothing prunes rows matching the victim's userId.

**Fix:** Inside the existing `resetPassword` transaction, add `DELETE FROM "session" WHERE sess::jsonb->>'userId' = $1`. Table name matches `connect-pg-simple` default.

**Safety concern:** raw SQL that references a table not managed by Drizzle. Use `sql.identifier` for the userId parameter to keep parameterization. Use `sql\`\`` tagged template. Table name in double-quotes (reserved-ish but fine).

**Tests affected:** None. The reset test doesn't check session invalidation (would need a pre-reset session to assert destruction).

**Rollback:** revert commit.

---

### #5 — P0-4: Audit log after attendance

**Bug:** `scan-verifier.js:55-72` writes `audit_log{result:'success'}` in `finally`. Then `scan-controller.js:47` inserts the attendance row. If the attendance insert throws any non-UNIQUE error (e.g. FK violation, timeout), audit log says success with no attendance row.

**Fix:**
- `scan-verifier.js`: return `tokenData` alongside result. Only log **failures** in the finally block (preserves audit-on-rejection guarantee). Don't log success here.
- `scan-controller.js`: after successful attendance insert, call `logAudit({result:'success', ...})` with the full context. If the insert throws UNIQUE (23505 — "already recorded"), audit separately with reason `'already_recorded'` so we still capture the attempt.

**Why not transaction-wrap both inserts:** audit_log has append-only triggers that don't play well with being tx-rolled-back; and if the attendance insert succeeds but audit insert fails, the product choice is that the attendance record is authoritative — we log the failure to console but don't revert. Acceptable given prior audit_logger.js design ("never throws").

**Tests affected:** none (no integration test exercises scan pipeline — only unit tests that mock the verifier). Existing unit tests for scan-verifier will need to adjust assertion on *when* logAudit is called (success path now doesn't call it).

**Rollback:** revert commit — restores prior behavior.

---

### #6 — P0-5: Graceful shutdown + unhandled handlers

**Bug:**
- `server.js:104` `setInterval(cleanupExpiredTokens, ...)` — handle discarded. Can never be cleared.
- `server.js:108` orphan-session cleanup is fire-and-forget; no error handling.
- Zero `process.on('SIGTERM'/'SIGINT'/'unhandledRejection'/'uncaughtException')`.
- Node 20 defaults to exit-on-unhandled-rejection. Any async Socket.IO listener throw → server crash, all live sessions drop.

**Fix — add to `server.js`:**
1. Capture `setInterval` handle into module-scope variable.
2. Export a `stopAllRefreshLoops` function from `qr-service.js` that iterates `activeLoops` and clears each.
3. Add `shutdown(signal)` function: stop accepting new connections, `clearInterval(tokenCleanupInterval)`, `stopAllRefreshLoops()`, `io.close()`, `httpServer.close()`, `await pool.end()`, process.exit(0).
4. Wire `process.on('SIGTERM'|'SIGINT', shutdown)`.
5. Wire `process.on('unhandledRejection', (err) => { console.error('UNHANDLED REJECTION', err); shutdown('unhandledRejection'); })`.
6. Wire `process.on('uncaughtException', ...)` similarly — but with `process.exit(1)` (truly unrecoverable state).

**Safety:** shutdown() must be idempotent (flag `isShuttingDown`) so repeated signals don't double-close.

**Render deployment:** Render sends SIGTERM on deploy. Graceful shutdown means in-flight scans finish (within a grace window) rather than being cut off. This is strictly an improvement.

**Tests affected:** None (server.js not imported by tests; tests build their own Express app).

**Rollback:** revert commit.

---

### #7 — P0-2: Client-side QR rendering

**Bug:** `instructor/session.html:191` builds `https://api.qrserver.com/v1/create-qr-code/?data=<signed-token>`. Every QR refresh (every 25s) transmits a valid scan-authorization token to an external service. An attacker with access to `api.qrserver.com` logs (or MITM) can replay tokens within their TTL.

**Fix:** Render QR in-browser via a pinned + SRI'd library. Chosen library: **`qrcodejs` via jsdelivr with SHA-384 SRI hash**. It's MIT-licensed, tiny (13kb), no dependencies, renders into a div via canvas/table.

**Alternative:** `qrcode` npm package (server-side rendering). Rejected because:
- Requires adding the npm dep back (prior audit removed it as "unused").
- Requires a new `/api/sessions/:id/qr-image` endpoint.
- Server-side rendering on Render free tier adds CPU cost per refresh.
- Client-side is strictly more private (payload never leaves browser).

**Safety:** SRI hash verified against the exact file at jsdelivr. If `qrcodejs` unavailable, loading fails closed (the QR doesn't render) rather than silently leaking tokens.

**Tests affected:** none (frontend, no unit tests for HTML).

**Manual validation:**
- Load session page; QR renders.
- Network tab: no requests to `api.qrserver.com`.
- Scan with student device — attendance recorded (end-to-end still works).

**Rollback:** revert commit.

---

### #8 — P0-8: DB CHECK constraints

**Bug:** Every `text()` enum column is constrained only in Drizzle TS. Raw SQL paths (`db.execute(sql\`...\`)`, any future direct pg.Pool usage, future microservices sharing DB) bypass.

**Fix:** New migration `drizzle/0003_enum_checks.sql`:
- `users.role CHECK IN ('student', 'instructor')`
- `sessions.status CHECK IN ('scheduled', 'active', 'closed', 'cancelled')`
- `attendance.status CHECK IN ('present', 'late', 'absent', 'excused')` (per schema)
- `audit_log.event_type CHECK IN ('scan_attempt', 'override', 'auth')`
- `audit_log.result CHECK IN ('success', 'rejected')`
- `email_verification_tokens.purpose CHECK IN ('email_verify', 'password_reset', 'device_rebind')`

Mirror in Drizzle schemas (`.check()` operator available in drizzle-orm 0.35+). Also update migration `meta/0003_snapshot.json` — but since drizzle-kit generates this, I'll use raw SQL migration and skip the snapshot update (drizzle-kit will reconcile on next `db:generate`).

**Safety:** Migration **only adds constraints**. It does NOT modify existing data. If existing data violates (should not, since app-layer enums enforce), the migration fails; we investigate rather than force. Use `NOT VALID` initially + `VALIDATE CONSTRAINT` if that concern materializes — but for this codebase expected-clean.

**Rollback script** (also committed as `drizzle/0003_enum_checks_rollback.sql` for reference, not applied):
```sql
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_status_check;
ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_status_check;
ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_event_type_check;
ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_result_check;
ALTER TABLE email_verification_tokens DROP CONSTRAINT IF EXISTS email_verification_tokens_purpose_check;
```

**Database migration path:** User must run `npm run db:push` or apply migration manually against Neon. **Not auto-applied** — migration is a file change, not a DB change. Plan notes this for the user.

**Tests affected:** None. Existing app-layer enum enforcement continues to reject invalid values before they hit DB.

**Rollback:** revert commit + manual `ALTER TABLE ... DROP CONSTRAINT` if the migration was already applied.

---

## Validation Plan

After each commit:
1. `npm test` — expect 43/43 pass (after test refactor in #2, same count).
2. `node --check` on edited `.js` files for syntax.

After all P0 complete:
3. `npm test` final — expect 43/43.
4. `npm run lint` — expect clean (or same warnings as baseline).
5. Diff summary: `git log --oneline pre-audit-remediation-20260418-0645..HEAD`.
6. Write `REMEDIATION_SUMMARY.md` with commit SHAs, rollback instructions, deploy notes (especially the migration for #8 that must be run against Neon).

---

## What Is NOT In This Plan

- P1 / P2 / P3 items from UNIFIED_REMEDIATION_PLAN.md. User will authorize those separately if desired.
- Production deploy. User ships when ready.
- Database migration application against Neon. User decides when to apply `0003_enum_checks.sql`.
- Documentation updates (FRS, PR2, PPTX) — already tracked in `DOCUMENT_UPDATE_INSTRUCTIONS.md`.

---

## Post-Execution Deliverable

`docs/audit/REMEDIATION_SUMMARY.md` will list:
- Every commit SHA + what it fixes
- Rollback command per fix (individual) and per batch
- Deploy checklist: env vars to verify, migrations to run, frontend reload, smoke test steps
