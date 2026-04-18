<!--
last_updated: 2026-04-18
auditor: Claude Opus 4.7 (1M context)
scope: AUDIT_07 — Data Consistency & Integrity
mode: READ-ONLY
-->

# AUDIT 07 — Data Consistency & Integrity

**Date:** 2026-04-18
**Database:** PostgreSQL 17 + PostGIS (Neon), 12 tables, Drizzle ORM
**Scope:** foreign-key ON DELETE behavior, transaction boundaries on multi-write flows, race conditions, soft/hard-delete consistency, audit-log integrity, JSONB/WKT/enum validation, timezone & null handling
**Reference fixes already in place (per `docs/SESSION_REPORT_FULL.md`):** `verifyEmail` transaction, enrollment soft-delete, `attendance UNIQUE(session_id, student_id)`, `audit_log` append-only triggers, QR token cleanup, rate limiting, session fixation fix. **Not repeated below.**

---

## Executive Summary

12-table schema with **11 FK constraints**. Enforcement is a mix of `ON DELETE cascade` (6), `ON DELETE no action` (5), and **zero use of CHECK constraints** — every text enum (`users.role`, `sessions.status`, `attendance.status`, `auditLog.eventType`, `auditLog.result`, `emailVerificationTokens.purpose`) is enforced only in Drizzle's TypeScript layer, not in the DB. Raw `db.execute(sql\`...\`)` calls bypass all of it.

Three high-impact classes of issue surfaced: **(a)** 4 multi-write flows (`createCourse`, `overrideAttendance`, `enrollByCode`, `startSession`) write to 2+ tables with no transaction — partial-failure states are reachable; **(b)** the `handleScan` → audit-log order is inverted: audit is written **before** attendance, so a DB error on the attendance insert leaves an orphan `audit_log.result='success'` row with no attendance; **(c)** FK `ON DELETE no action` on `courses.instructor_id`, `attendance.session_id`, `attendance.student_id`, and `auditLog.actor_id` means deleting an instructor or a student (or running a session purge) will hard-error — there is no deletion path that actually works.

**Findings:** 3 critical, 7 high, 9 medium, 4 low. Total: **23**.

---

## Findings Summary Table

| # | Area | Severity | Title |
|---|---|---|---|
| 1 | Transaction | CRITICAL | `handleScan` writes audit before attendance — rollback creates orphan audit success |
| 2 | Transaction | CRITICAL | `createCourse` — course insert + session batch insert are two separate statements |
| 3 | Enum enforcement | CRITICAL | No DB-level CHECK on any status/role/purpose enum — raw SQL can insert anything |
| 4 | FK cascade | HIGH | `courses.instructor_id` is `ON DELETE no action`; instructor rows have CASCADE from users → delete chain is broken |
| 5 | FK cascade | HIGH | `attendance.session_id` and `attendance.student_id` both `ON DELETE no action` — session/student delete will error |
| 6 | FK cascade | HIGH | `audit_log.actor_id ON DELETE no action` — user delete blocked by any prior scan/override |
| 7 | Race | HIGH | `overrideAttendance` is not transactional + not `ON CONFLICT` — two concurrent overrides lose one, or the second crashes on `UNIQUE(session_id, student_id)` |
| 8 | Race | HIGH | `executeEnrollment` (select-then-update/insert) is not atomic — concurrent enrolls yield either duplicate PK error or one request silently wins |
| 9 | Race | HIGH | `startSession` uses no row lock — two instructor tabs each start a QR loop and emit tokens to the same session |
| 10 | Validation | HIGH | `weekly_schedule` jsonb has no DB or Zod structural guard beyond "array of {day,start,end}"; `generateSessions` silently skips bad `day` values |
| 11 | Transaction | MEDIUM | `enrollByCode` / `enrollInCourse` — re-enroll update and insert are outside a transaction; two concurrent requests can both pass the existence check |
| 12 | Validation | MEDIUM | `geofence_center` WKT is built by string interpolation with no range check on lat/lng; invalid WKT only fails later in `checkGeofence` at scan time |
| 13 | Validation | MEDIUM | `geofence_radius_m` CHECK 10–500 promised by `SCHEMA.md` is only in Zod (`GEOFENCE_MIN_RADIUS_M`/`MAX`); raw updates bypass it |
| 14 | Validation | MEDIUM | `warning_threshold_pct numeric(5,2)` — no 0–100 CHECK; Zod limits it only on create, not on regen of other fields |
| 15 | Soft/hard delete | MEDIUM | `enrollments` is soft-delete, but `courses ON DELETE cascade` hard-deletes them — hard-delete of a course wipes historical attendance indirectly via session cascade |
| 16 | Index | MEDIUM | `SCHEMA.md` promises `audit_log_target_idx` + `SESSION_REPORT_FULL.md` claims it was added; neither schema nor migration has it. `getAuditLog` filters by `target_id` |
| 17 | Consistency | MEDIUM | `audit_log.details` JSONB has no schema; override entry stores `studentId` there instead of in `target_id`, breaking audit-by-student queries |
| 18 | Race | MEDIUM | `generateEnrollmentCode` has TOCTOU: select-then-insert with no unique-retry wrapping the actual INSERT — relies on UNIQUE but never retries on 23505 |
| 19 | Null | MEDIUM | `attendance.status='excused'` should require `excuse_reason`; enforced only in Zod on override path, not at DB level |
| 20 | Timezone | LOW | Sessions generated with `new Date(semesterStart)` — parses as UTC midnight, not Kuwait midnight; Feb-1 00:00 Kuwait becomes Jan-31 21:00 UTC, and every session's clock time is off by 3h when read back as Kuwait local |
| 21 | Null | LOW | `students.device_fingerprint` nullable with no partial UNIQUE — same fingerprint can be bound to multiple students |
| 22 | Null | LOW | `courses.enrollment_code` unique but case-sensitive; alphabet is uppercase-only so practical collision is zero, but no normalization on input |
| 23 | Audit | LOW | `audit_log` append-only triggers don't prevent `TRUNCATE` (only UPDATE/DELETE) |

---

## Per-Finding Detail

### 1. `handleScan` writes audit before attendance → orphan audit success (CRITICAL)

**Root cause.** `scan-verifier.js:55-72` writes `audit_log` with `result: 'success'` inside a `finally` block **before** control returns to `scan-controller.js:47-63`, which then inserts into `attendance`. If the attendance insert fails for any reason other than the already-handled 23505 (network blip, constraint violation from a future migration, connection drop), the audit row stays but the attendance row is never written.

**Proof.**
- `src/backend/validators/scan-verifier.js:57` — `await logAudit({...result.success ? 'success' : 'rejected'...})`
- `src/backend/controllers/scan-controller.js:47-56` — `await db.insert(attendance).values({...})` happens **after** `verifyScan` returns
- `src/backend/validators/audit-logger.js:19-22` — audit failure is swallowed (`console.error`), so it won't even surface the inconsistency

**Fix.** Move the audit write into `handleScan` after the attendance insert, or wrap both in `db.transaction()`. Audit triggers prevent UPDATE/DELETE, so use `savepoint` + conditional insert. Alternative: keep `finally` logging but distinguish "verified" from "recorded" in the `result` field.

---

### 2. `createCourse` — course insert + session batch insert not transactional (CRITICAL)

**Root cause.** `course-controller.js:113-143` inserts `courses` (returning the new id), then separately inserts a computed batch into `sessions`. If the second insert fails (e.g. >1000 rows hit a param limit, DB restart mid-call), the course exists with no sessions. No student can enroll-by-code and attend until the instructor notices and recreates — and there's no retry or cleanup.

**Proof.** `course-controller.js:113, 142` — two separate `await db.insert(...)` calls outside any `db.transaction()`.

**Fix.** Wrap both inserts in `db.transaction(async tx => ...)`; rollback on session-insert failure so the course never appears.

---

### 3. No DB-level CHECK on any enum (CRITICAL)

**Root cause.** Every `text` enum column (`users.role`, `sessions.status`, `attendance.status`, `audit_log.event_type`, `audit_log.result`, `email_verification_tokens.purpose`) declares an `enum` in Drizzle (e.g. `src/backend/db/schema/user.schema.js:8`) but Drizzle `pg-core` does **not** emit a CHECK. Migration 0000/0001 prove this:

```sql
-- drizzle/0000_outstanding_psynapse.sql:67
"role" text NOT NULL,                      -- no CHECK
-- drizzle/0001_sudden_scalphunter.sql:5
"status" text NOT NULL,                    -- attendance, no CHECK
-- drizzle/0001_sudden_scalphunter.sql:18-21
"event_type" text NOT NULL,                -- no CHECK
"result" text NOT NULL,                    -- no CHECK
```

**Proof.** `SCHEMA.md:37,111,141,161,162,193` all promise `CHECK in (...)`, but `grep -r 'CHECK' drizzle/` → **zero matches**. Anywhere raw SQL is used (`scan-controller.js:67-75`, `report-controller.js:245-254`, `notification-service.js:132-134`, `qr-service.js:109`) Drizzle's type layer is bypassed.

**Fix.** Add a migration `ALTER TABLE ... ADD CONSTRAINT ..._status_ck CHECK (status IN ('present','absent','excused'))` for all 6 enum columns documented in `SCHEMA.md`.

---

### 4. `courses.instructor_id` has `ON DELETE no action` (HIGH)

**Root cause.** `course.schema.js:8` defines `.references(() => instructors.userId)` with no `onDelete`, producing `ON DELETE no action` (`drizzle/0000_outstanding_psynapse.sql:75`). But `instructors.user_id` is `ON DELETE cascade` from `users` (same migration line 79). Deleting a user cascades to `instructors` but is **blocked** there by any `courses` row, so the cascade from `users` actually raises a FK violation. There is no documented path to delete an instructor.

**Proof.**
```sql
-- drizzle/0000_outstanding_psynapse.sql:75
ALTER TABLE "courses" ... FOREIGN KEY ("instructor_id")
  REFERENCES "instructors"("user_id") ON DELETE no action ...
-- line 79
ALTER TABLE "instructors" ... FOREIGN KEY ("user_id")
  REFERENCES "users"("user_id") ON DELETE cascade ...
```

**Fix.** Decide policy. Either `ON DELETE restrict` (explicit: "archive courses first") and document it, or `ON DELETE cascade` (accept losing all their courses + sessions + attendance). Current silent `no action` means the cascade chain is unreachable.

---

### 5. `attendance.session_id` / `attendance.student_id` both `ON DELETE no action` (HIGH)

**Root cause.** `attendance.schema.js:11,14` — `.references(() => sessions.sessionId)` and `.references(() => students.userId)` with no `onDelete`. Migration `drizzle/0001_sudden_scalphunter.sql:35-36` confirms `ON DELETE no action` for both.

**Impact.**
- Deleting a course cascades to `sessions` (ok), but session delete is then blocked by any attendance row → the cascade hard-errors mid-flight.
- A student can never be deleted (even admin-side) if they ever attended.
- Hard-delete of a course silently fails with a 500 if any session has attendance.

**Proof.** `drizzle/0000_outstanding_psynapse.sql:80` — `sessions.course_id ON DELETE cascade`; `drizzle/0001_sudden_scalphunter.sql:35` — `attendance.session_id ON DELETE no action`. These are inconsistent.

**Fix.** Either propagate cascade all the way (`attendance.session_id ON DELETE cascade` + same for `student_id`), or change course delete to soft-delete and keep `no action`. Pick one policy across the chain.

---

### 6. `audit_log.actor_id ON DELETE no action` blocks user delete (HIGH)

**Root cause.** `audit-log.schema.js:10` references `users.userId` with no `onDelete`. Migration line 37 confirms `no action`. Any user who has ever scanned or been overridden cannot be deleted — and given that `email_verification_tokens ON DELETE cascade` from users, a user-delete attempt partially succeeds then fails, potentially leaving the user row deleted but tokens orphaned depending on order (Postgres defers integrity within transaction, so it'll roll back, but the policy is still wrong for a GDPR/data-retention request).

**Fix.** `ON DELETE set null` for `audit_log.actor_id` — the FR requires audit immutability (triggers prevent UPDATE/DELETE of rows), but an actor id becoming NULL on user delete preserves the log row and breaks the blocking ref. **Caveat:** the append-only trigger will reject the cascade-update; will need to exempt the trigger for FK-driven SET NULL (`WHEN (OLD.actor_id IS DISTINCT FROM NEW.actor_id AND NEW.actor_id IS NULL)`) or change policy to keep the actor id but delete the user row via tombstone.

---

### 7. `overrideAttendance` race: concurrent overrides (HIGH)

**Root cause.** `override-controller.js:37-61` does `SELECT existing → UPDATE or INSERT` with no row lock and no transaction. Two instructors (or the same instructor in two tabs) overriding the same (session, student) at once:
- Both see `existing = null`
- Both issue INSERT
- Second hits `UNIQUE(session_id, student_id)` (from `drizzle/0001_sudden_scalphunter.sql:39`) and returns 500 to the client
- The paired audit_log insert on line 64 still runs for the crashing request? No — `await` chain means it doesn't. But if both see `existing` and both UPDATE, last-write-wins silently, and both audit rows record the same `oldStatus`, making the timeline incoherent.

**Proof.** `override-controller.js:37-61` — no `db.transaction`, no `SELECT ... FOR UPDATE`, no `ON CONFLICT`.

**Fix.** Wrap in `db.transaction()`, use `INSERT ... ON CONFLICT (session_id, student_id) DO UPDATE SET status=excluded.status, excuse_reason=excluded.excuse_reason RETURNING *`. Derive `oldStatus` inside the tx using a `SELECT ... FOR UPDATE` before the upsert.

---

### 8. `executeEnrollment` race: concurrent enrolls (HIGH)

**Root cause.** `course-controller.js:68-93` is `SELECT → UPDATE-if-soft-deleted → INSERT-otherwise` with no lock. Two `enrollByCode` calls for the same (course, student) in flight: both see `existing = null`, both INSERT, the second hits the PK `(course_id, student_id)` and returns 500.

If one record is soft-deleted (`removed_at NOT NULL`), both see it, both issue UPDATE `removedAt: null, enrolledAt: now()`. Last-write-wins on `enrolledAt` — benign but loses one of the timestamps. More concerning: if one request is "new enroll" and the other is "update existing to un-soft-delete" (theoretical edge), the behavior is undefined.

**Proof.** `course-controller.js:68-93` — classic TOCTOU.

**Fix.** Single `INSERT ... ON CONFLICT (course_id, student_id) DO UPDATE SET removed_at=NULL, enrolled_at=now() RETURNING *`. Returns 200 on fresh insert and 200 on re-enroll with the same code path. Drop the `SELECT` entirely.

---

### 9. `startSession` race: two instructors start simultaneously (HIGH)

**Root cause.** `session-controller.js:11-44` — status check (line 25), status update (line 33), then `startRefreshLoop` (line 39). No row lock. The refresh-loop state is held in the Node process (`qr-service.js:6 activeLoops`, an in-memory Map) **and is per-process**. Two concurrent requests:
- Both read `status='scheduled'`
- Both write `status='active'` (last wins, benign)
- Both call `startRefreshLoop`, which does `stopRefreshLoop(sessionId)` first (qr-service.js:55) — so only the later one survives *in the same process*
- But if there are ever >1 Node workers (the app runs on Render which today is single-process, but this is not guarded), both workers will spawn independent `setInterval` timers, both emitting QR payloads via Socket.IO, doubling token churn and inflating `qr_tokens` rows

**Proof.** `session-controller.js:33-39`, `qr-service.js:5, 53-73`.

**Fix.** Use `UPDATE sessions SET status='active', actual_start=now() WHERE session_id=$1 AND status='scheduled' RETURNING *` — if rowcount=0, return 409. And/or move QR loop state from in-memory Map to a DB row (e.g. `sessions.refresh_owner_node_id`) with `SELECT ... FOR UPDATE` to enforce one owner.

---

### 10. `weekly_schedule` jsonb validation (HIGH)

**Root cause.** `course-controller.js:24-30` validates the shape `{day, start, end}` with `z.enum` on day and `/^\d{2}:\d{2}$/` regex on times. But:
- No check that `start < end` (you can post `{day:'mon', start:'23:00', end:'01:00'}`; `session-generator.js:49` produces a session ending before it starts)
- No check that hours are 0–23 or minutes 0–59 (e.g. `99:99` passes the regex)
- `session-generator.js:36` silently drops unknown days with `if (targetDay === undefined) continue;` — but since Zod enforces the enum on create, the defensive branch only helps for direct DB writes bypassing Zod
- No DB-level `CHECK (jsonb_typeof(weekly_schedule) = 'array')`

**Proof.** `course-controller.js:24-30`, `session-generator.js:36, 49`, `course.schema.js:22`.

**Fix.** Tighten Zod with `.refine(s => s.start < s.end)` and `.regex(/^([01]\d|2[0-3]):[0-5]\d$/)`. Add a DB CHECK to guarantee array-of-object shape for bypass paths.

---

### 11. `enrollByCode` re-enroll race — see #8 (MEDIUM — subset of #8)

Same root cause as #8; flagged separately because `enrollInCourse` and `enrollByCode` both call the same non-atomic helper — a fix belongs in `executeEnrollment` only. **Skip if #8 fixed.**

---

### 12. `geofence_center` WKT built by string interpolation (MEDIUM)

**Root cause.** `course-controller.js:111` and `:235`:
```js
const geofenceCenter = `SRID=4326;POINT(${data.geofenceLng} ${data.geofenceLat})`;
```
Zod enforces lat/lng range at create time (`course-controller.js:31-32`), but `updateCourse` (`:234-236`) uses `req.body.geofenceLat` and `req.body.geofenceLng` **without Zod** — only the radius is bounds-checked. Sending `geofenceLat: "foo"` writes `SRID=4326;POINT(NaN NaN)` to the DB. The failure surfaces only on the next scan when `ST_GeogFromText('SRID=4326;POINT(NaN NaN)')` throws.

**Proof.** `course-controller.js:227-257` — no Zod on the update body; direct interpolation into WKT on line 235.

**Fix.** Add a Zod schema for `updateCourse` that mirrors the create schema for lat/lng. Or: validate the WKT server-side with a PostGIS `SELECT ST_GeogFromText($1)` round-trip before INSERT/UPDATE.

---

### 13. `geofence_radius_m` CHECK 10–500 missing from DB (MEDIUM)

**Root cause.** `SCHEMA.md:76` says `CHECK between 10 and 500 (app-side)` but the comment acknowledges it's app-only. Migration line `drizzle/0000_outstanding_psynapse.sql:10` has no CHECK. Zod enforces it on create and on update (`course-controller.js:238-241`), but `db.execute(sql\`UPDATE courses SET geofence_radius_m=...\`)` (not currently used, but future code or admin SQL) bypasses it.

**Fix.** Add `CHECK (geofence_radius_m BETWEEN 10 AND 500)` migration.

---

### 14. `warning_threshold_pct` no DB range check (MEDIUM)

**Root cause.** `course.schema.js:18-20` — `numeric(5,2)`. Zod checks 0–100 on create (`course-controller.js:35`) but on update (`course-controller.js:245`) accepts anything `!= undefined` and casts to string. Raw update via SQL could store `999.99` or negative.

**Fix.** Add `CHECK (warning_threshold_pct BETWEEN 0 AND 100)`; add a `.min(0).max(100)` on the update path.

---

### 15. Hard-delete course wipes attendance via cascade — conflicts with soft-delete intent (MEDIUM)

**Root cause.** `enrollments.course_id ON DELETE cascade` (`drizzle/0000_outstanding_psynapse.sql:77`) + `sessions.course_id ON DELETE cascade` (line 80) mean that if a course is ever deleted (no UI for it yet, but no guard either), all enrollment history **and** attendance history (via finding #5 — which will actually error) is destroyed. SCHEMA.md explicitly says enrollment is soft-delete for history retention, but course cascade undoes that.

**Proof.** `SCHEMA.md:95` "Soft-delete; historical records retained" + `SCHEMA.md:92` `ON DELETE CASCADE`. Contradiction in the spec itself.

**Fix.** Change course-delete to a soft-delete (`courses.archived_at`) and forbid hard DELETE (revoke permission or `ON DELETE restrict`). Filter `archived_at IS NULL` in queries.

---

### 16. `audit_log_target_idx` missing (MEDIUM)

**Root cause.** `SCHEMA.md:170` promises `CREATE INDEX audit_log_target_idx ON audit_log(target_id);` and `SESSION_REPORT_FULL.md:109` claims it was added during Audit Round 3. Reality:
- `src/backend/db/schema/audit-log.schema.js:16-19` — indexes are only `timestamp` and `actorId`
- `drizzle/0001_sudden_scalphunter.sql:41-42` — same; no target_id index

`report-controller.js:245-254` filters `audit_log WHERE target_id = ANY($1)` with no supporting index — full table scan grows with every scan attempt.

**Fix.** Add the index in a new migration and update the Drizzle schema.

---

### 17. `audit_log.details` schemaless; override stores studentId in details not target_id (MEDIUM)

**Root cause.** `override-controller.js:64-77` writes `targetId: sessionId` and puts `studentId` only inside `details` JSONB. But `SCHEMA.md:163` documents `target_id` as "Session ID for scan, **student ID for override**". Code contradicts spec; audit-by-student queries silently miss override events unless they also JSON-extract `details->>'studentId'`.

**Proof.** `override-controller.js:67, 71`, vs `SCHEMA.md:163`.

**Fix.** Either (a) write `targetId: studentId` per spec and keep `sessionId` in details, or (b) update SCHEMA.md to match code and add a composite "target" jsonb. Pick one; document; add a CHECK on `details` shape.

---

### 18. `generateEnrollmentCode` TOCTOU (MEDIUM)

**Root cause.** `enrollment-code.js:14-35` loops `generate → SELECT → if empty, return`. The returned code is then used in `createCourse` at `course-controller.js:121`. Between the SELECT inside the helper and the INSERT on line 113, a parallel `createCourse` could claim the same code. The DB UNIQUE (`courses.enrollment_code`) catches it and raises 23505, but there's no retry — the whole request 500s. With a 32-char alphabet and 6-char codes (~1B space) it's rare, but the fault model is wrong.

**Fix.** Drop the SELECT, insert directly with `ON CONFLICT (enrollment_code) DO NOTHING RETURNING *`, retry on empty return up to N times.

---

### 19. `attendance` excuse_reason required for excused but not enforced at DB (MEDIUM)

**Root cause.** `attendance.schema.js:23` — `excuseReason: text('excuse_reason')` nullable. `override-controller.js:10` Zod requires non-empty `reason` for any override, and line 59 stores it only when status='excused'. But a direct INSERT with `status='excused'` and NULL `excuse_reason` is accepted by the DB. And `handleScan` inserts with `status='present'`, leaving the field as designed.

**Fix.** Add `CHECK ((status='excused' AND excuse_reason IS NOT NULL) OR (status IN ('present','absent')))`.

---

### 20. Session generation timezone drift (LOW)

**Root cause.** `session-generator.js:29-30`:
```js
const start = new Date(semesterStart);  // semesterStart is "2026-02-01"
```
`new Date('2026-02-01')` in Node parses as UTC midnight. `setHours(current, 9)` then sets hours in the server's **local time** (on Render the container is UTC by default). Result: if server is UTC, a Mon 09:00 slot is inserted as `2026-02-02T09:00:00+00` — which when viewed as Kuwait time (UTC+3) is 12:00 noon. The bug compounds if the server's TZ is ever not UTC.

**Proof.** `session-generator.js:29, 49-50` plus no `TZ=Asia/Kuwait` in `package.json`/`render.yaml` (render.yaml would need to set it explicitly).

**Fix.** Use a timezone-aware library (date-fns-tz was removed per SESSION_REPORT_FULL.md:109 — restore it, or use Luxon) and parse/construct all times in `Asia/Kuwait`, then serialize to `timestamptz`. Or set `process.env.TZ = 'Asia/Kuwait'` on boot. Given Kuwait has no DST, setting server TZ is the simplest fix.

---

### 21. `students.device_fingerprint` — no partial UNIQUE (LOW)

**Root cause.** `user.schema.js:20` — plain nullable text. A shared-device family (unlikely in AUK but possible — sibling students sharing a phone) could bind the same fingerprint to two student rows. The DeviceChecker (`device-checker.js:30`) would then allow both students to scan from the one phone. FR says device-bind is 1:1.

**Fix.** Add partial unique index: `CREATE UNIQUE INDEX students_device_fingerprint_uidx ON students(device_fingerprint) WHERE device_fingerprint IS NOT NULL;` — second bind attempt fails; user takes the `request-rebind` path.

---

### 22. `enrollment_code` case normalization (LOW)

**Root cause.** Alphabet in `config/constants.js` (per `ENROLLMENT_CODE_ALPHABET`) is uppercase-safe, but `enrollByCode` passes `parsed.data.enrollmentCode` straight into `where(eq(courses.enrollmentCode, ...))` (`course-controller.js:295`). If a student types a lowercase code from a scanned image, lookup fails. Not strictly a consistency bug but causes spurious 404s.

**Fix.** `.toUpperCase()` in the Zod transform, and lowercase the DB column on insert (normalize both sides).

---

### 23. `audit_log` append-only triggers don't cover TRUNCATE (LOW)

**Root cause.** `drizzle/0001_sudden_scalphunter.sql:50-52` installs BEFORE UPDATE and BEFORE DELETE triggers. PostgreSQL allows a separate `TRUNCATE` trigger; without it, `TRUNCATE audit_log` by a superuser or faulty migration wipes the log. The SCHEMA.md only documents UPDATE/DELETE.

**Fix.** Add `CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_log_modify();` — or revoke TRUNCATE privilege from the app role (better: defense in depth, do both).

---

## Cross-cutting Notes

- **Timezone.** All `timestamp` columns use `{ withTimezone: true }` (i.e. `timestamptz`) — correct. The actual bug is application-side (finding #20), not storage.
- **Null handling.** `password_hash NOT NULL` — correct. `role NOT NULL` — correct. `email_verified_at NULL` — correct (nullable-until-verified pattern). `students.device_fingerprint` and `.device_bound_at` nullable — correct intent but see #21.
- **Race on attendance write.** Covered correctly by `UNIQUE(session_id, student_id)` + the `23505` branch in `scan-controller.js:59`. **Not a bug.**
- **Transactions that ARE in place.** `auth-controller.js:86, 229, 257, 367` — register, verifyCode, verifyEmail, resetPassword all correctly wrapped. Good.
- **Missing:** no transaction in `notification-service.js` when inserting `warning_email_log` + sending email. Email send failure leaves a "warning fired" marker with no email. MEDIUM if we extend the audit; not counted above because email is a best-effort side channel and the marker is the intended idempotency guard.

---

## Recommended Fix Order

**P0 (correctness):** #1, #2, #3, #7, #8, #9
**P1 (FK policy coherence):** #4, #5, #6, #15
**P2 (validation hardening):** #10, #12, #13, #14, #19
**P3 (hygiene):** #16, #17, #18, #20, #21, #22, #23

---

## Out of Scope

Performance indexes beyond #16, privacy/PII retention, backup policy, PostGIS spatial index (`GIST` on geofence_center would accelerate geofence queries — not a consistency issue). Covered by separate audits.
