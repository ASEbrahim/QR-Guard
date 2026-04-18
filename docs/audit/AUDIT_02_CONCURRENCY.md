# QR-Guard Concurrency Audit Report

**Date:** 2026-04-18
**Auditor:** Claude Opus 4.7 (1M context)
**Scope:** Node.js backend (`src/backend/`) — Express, Drizzle/node-postgres (Pool), Socket.IO, express-session + connect-pg-simple, in-process `setInterval` loops, in-process `Map` state.
**Runtime model:** Single Node.js process, event-loop concurrency (no worker threads). All DB access goes through a single PostgreSQL `pg.Pool`. Background work runs via `setInterval` owned by the same process. Deployed on Render as a single instance today, but nothing in the code is coupled to that assumption.

---

## Executive Summary

QR-Guard has most of the "obvious" concurrency bases covered at the data layer: a UNIQUE index on `(session_id, student_id)` catches concurrent scans from the same student, an append-only trigger protects `audit_log`, and `stopRefreshLoop(sessionId)` is called before starting a new loop. The prior session (per `SESSION_REPORT_FULL.md`) already addressed Socket.IO auth, join-session enrollment checks, orphan-session cleanup at startup, and QR token cleanup.

However, there are real races that survive those fixes. The dominant pattern is **check-then-act** on mutable DB state without a transaction or row lock: `startSession` reads status then updates it; `overrideAttendance` reads then inserts/updates; `notification-service.checkThresholdAndNotify` reads the open-crossing row then inserts. Several of these are triggered by UX paths (double-click start, simultaneous scan + override) where the race window is realistic, not theoretical.

Additionally, some state lives only in-process: `activeLoops` Map in `qr-service.js`, the `io` singleton in `socket-service.js`, and express-rate-limit's default memory store. These are fine today (single instance) but silently break correctness the moment a second instance boots — worth flagging because multi-instance is the natural next step for Render.

**Findings: 11** (1 Critical, 4 High, 4 Medium, 2 Low)

---

## Summary Table

| # | Severity | Area | File | Summary |
|---|---|---|---|---|
| 1 | **High** | Session lifecycle | `session-controller.js:25-41` | `startSession` read-check-then-update is not atomic; two instructor clicks can both pass the `status='active'` check and spawn two refresh loops (second `stopRefreshLoop` clobbers the first's interval handle but the first `generateQrToken` insert has already happened) |
| 2 | **High** | Override vs scan | `override-controller.js:37-61` | Check-for-existing then insert/update without a transaction or row lock: concurrent override + scan (or two overrides) race on the attendance row. INSERT path hits the UNIQUE constraint and 500s to the instructor; UPDATE path can overwrite a just-landed scan |
| 3 | **High** | Threshold notifications | `notification-service.js:30-50` | Concurrent scans (or override + scan) both read "no open crossing", both INSERT a new `warning_email_log` row — succeeds because PK includes `crossedBelowAt` (timestamp) — resulting in **duplicate warning emails** for the same crossing |
| 4 | **Critical** | Multi-instance deploy | `qr-service.js:5`, `socket-service.js:7`, `rate-limiter.js` | `activeLoops` Map, Socket.IO `io` singleton, and express-rate-limit memory store are in-process. Under two Render instances: QR loop runs on instance A, scan lands on instance B, instance B's Socket.IO room has no subscribers for `attendance:update`, instructor's live counter stops. Also, orphan-session cleanup at startup (server.js:108) closes all active sessions including ones owned by the peer instance |
| 5 | **High** | Orphan cleanup race | `server.js:108` | On startup, unconditionally sets `status='closed'` on every active session. If two instances boot together (Render rolling restart), both nuke each other's active sessions; refresh loops keep pushing tokens but DB says closed, scans then fail at some downstream check |
| 6 | **Medium** | QR refresh overlap | `qr-service.js:62-69` | `setInterval` does not await the prior tick; if `generateQrToken` takes longer than `qrRefreshIntervalSeconds` (DB latency spike), a second tick fires while the first is mid-flight. Two `qr_tokens` INSERTs land for the same session; `getCurrentToken` picks the latest by `generatedAt DESC`, but the older in-flight one is also valid, so the student can still scan the stale QR even after the UI "refreshed" |
| 7 | **Medium** | Prior-token validity window | `qr-validator.js:27-34` + `qr-service.js:33` | Newly-issued tokens do not invalidate prior ones — both remain valid until their own `expiresAt`. If the refresh interval (e.g., 25s) is shorter than `expiresAt - generatedAt` (set to the same 25s, but clock skew or insert latency can make N+1 tokens overlap by hundreds of ms), a student who scans the displayed QR a few ms after it rotated in the UI can still succeed against the prior DB row. Not strictly wrong per the "fresh QR" goal, but contradicts the spirit: students can reuse a photograph of the prior QR until its own TTL elapses |
| 8 | **Medium** | Missing transaction — override | `override-controller.js:44-77` | Attendance row UPSERT and audit-log INSERT are two separate statements with no transaction. If the audit INSERT fails (e.g., FK violation, connection reset mid-request), the attendance change is persisted without an audit entry, violating the "every override is audit-logged" invariant |
| 9 | **Medium** | Missing transaction — scan | `scan-controller.js:47-63`, `scan-verifier.js:55-71` | Attendance INSERT (scan-controller) and audit INSERT (audit-logger, in `finally`) happen on separate connections. If the process crashes between the two, the attendance row exists without an audit entry. The audit-logger also swallows its own errors (`console.error`, no throw), so partial persistence is silently possible |
| 10 | **Low** | Device binding TOCTOU | `auth-controller.js:162-175` | First-login device binding reads `student.deviceFingerprint` then conditionally updates. Two near-simultaneous first logins (different devices) both see `null`, both write — the second UPDATE wins. Second device becomes the bound one without a rebind flow. Narrow window (only fires on users with no binding yet) but trivially exploitable if two logins are scripted |
| 11 | **Low** | Re-enrollment race | `course-controller.js:68-92` | `executeEnrollment` reads existing row (soft-deleted or not), then branches to UPDATE/INSERT. No row lock. Two concurrent enrolls by the same student: both read `no row`, both INSERT — fails on primary-key collision (composite PK on `course_id, student_id`), one returns 500. Benign (PK protects data integrity), but the error bubbles up as a generic 500 instead of "already enrolled" |

---

## Detailed Findings

### 1. `startSession` check-then-update is not atomic — double-start race

**Severity:** High
**File:** `src/backend/controllers/session-controller.js:14-43`

The handler reads `session.status`, returns 400 if already `active`, then executes the UPDATE + calls `startRefreshLoop` in separate statements. There is no transaction, no `SELECT ... FOR UPDATE`, and no DB constraint preventing status transitions.

**Interleaving:**
1. Instructor double-clicks "Start" (or start endpoint + a retry from a flaky connection). Request A and Request B land on the event loop within milliseconds.
2. Request A: `SELECT` returns `status='scheduled'`. Passes the `!== 'active'` check.
3. Request B: `SELECT` returns `status='scheduled'` (A hasn't updated yet because `await` on the select already yielded). Passes the check.
4. Request A: `UPDATE sessions SET status='active', actual_start=now()`. Calls `startRefreshLoop(id, course, ...)`, which inserts `qr_tokens` row #1 and sets `activeLoops[id] = intervalA`.
5. Request B: `UPDATE sessions SET status='active', actual_start=now()` — **overwrites Request A's `actual_start`**. Calls `startRefreshLoop(id, ...)`. Inside, `stopRefreshLoop(id)` clears `intervalA` (correct — the map prevents leak). Inserts `qr_tokens` row #2. Sets `activeLoops[id] = intervalB`.

**Consequences:**
- `actual_start` timestamp is clobbered (minor).
- The `emitQrRefresh` callback captured by Request A's closure fires **once** for `qr_tokens` row #1 before its interval is cleared. Students who were already watching may see a QR that is then replaced 25s later by Request B's loop.
- In the window between step 4 and the `stopRefreshLoop` in step 5, **two intervals exist in memory** for the same session. They're both driving `emitQrRefresh`. Order of tokens reaching students is nondeterministic.
- No data corruption per se, but the UX promise of "one live QR at a time" is violated for a few seconds.

**What protects:** Nothing. The UNIQUE on `qr_tokens.payload` does not help because both tokens have different `ts` in the payload.

**Recommended fix (out of scope — read-only audit):** Wrap the status check + UPDATE in a transaction with `SELECT ... FOR UPDATE` on the session row, or use a single conditional UPDATE (`UPDATE ... WHERE status='scheduled' RETURNING *`) and branch on whether a row came back.

---

### 2. Override vs scan — UPSERT-via-branch is racy

**Severity:** High
**File:** `src/backend/controllers/override-controller.js:37-61`

`overrideAttendance` reads `existing` attendance row, then either UPDATEs it or INSERTs a new one. Meanwhile, `scan-controller.js:47` inserts a fresh attendance row for the student.

**Interleaving A (override + scan concurrent):**
1. Instructor triggers override for student S with `status='excused'`. Request O reads attendance — no row exists.
2. Student S scans successfully. Request N runs `INSERT INTO attendance (...) VALUES ('present', ...)`. Row lands.
3. Request O proceeds to the INSERT branch (because its SELECT returned nothing). INSERT fails with `23505` (UNIQUE violation on `session_id, student_id`). Controller does not catch this — it bubbles to the 500 error handler. Instructor sees "Internal server error" even though the override was logically valid.

**Interleaving B (override + scan, different order):**
1. Student scans at t0 → row inserted as `present`.
2. Override endpoint at t0+50ms reads attendance — row exists, status `present`. Plans UPDATE branch.
3. [No second scan arrives, but] between the SELECT and UPDATE, another override (or the threshold notifier's own read) could see the same `present` row and issue conflicting UPDATEs. The last UPDATE wins.
4. The `oldStatus` recorded in `audit_log.details` (line 70) is stale — it reflects the status at SELECT time, not the one actually overwritten.

**Interleaving C (two concurrent overrides):**
Two instructors share a course (supported per course-controller — but in practice one instructor owns a course; still, two browser tabs): both overrides read `existing=null` (no scan yet), both branch to INSERT, second fails with `23505` → 500.

**What protects:** The UNIQUE index on `(session_id, student_id)` guarantees no duplicate rows, but the controller does not handle the `23505` error (unlike `scan-controller.js:59` which does). So the instructor gets a raw 500.

**Consequences:** Incorrect `oldStatus` in audit log; occasional 500 on override when a scan is concurrent; silent overwrite of a scan by a same-status override with different `recordedAt`.

---

### 3. Duplicate warning emails on concurrent scan pipeline

**Severity:** High
**File:** `src/backend/services/notification-service.js:20-50`

`checkThresholdAndNotify` is invoked from both `scan-controller.js:88` (after every successful scan) and `override-controller.js:81` (after every override). It reads the open-crossing row (WHERE `recovered_above_at IS NULL`), then INSERTs a new `warning_email_log` row if none exists.

**Interleaving:**
1. Student S is at 71% attendance (threshold = 75%). Two scans for the same session fail (too far), but both successfully log a scan — wait, `checkThresholdAndNotify` only fires on `success`. So the real trigger is: student scans session X (success, attendance drops via recalc — unlikely) OR more realistically: instructor overrides to `absent` twice in two tabs, or override + scheduled-session auto-close both recalculate.
2. More concretely: student scans session X (success, no threshold change) while instructor simultaneously overrides a past session Y to `absent` for same student. Both trigger `checkThresholdAndNotify(courseId, studentId)`.
3. Both compute `pct=70%`, both read no open crossing, both `INSERT INTO warning_email_log`.
4. The PK is `(course_id, student_id, crossed_below_at)`. Because `crossedBelowAt: new Date()` produces different millisecond timestamps for the two requests, **both inserts succeed**.
5. Two warning emails are sent for the same crossing. If the AUK 15% block (line 80) also fires, the instructor gets two notifications too.

**What protects:** The PK includes `crossedBelowAt`, which is exactly what defeats the de-dup — it was chosen to allow "new row on each threshold crossing" but it allows millisecond-duplicate inserts as a side effect.

**Consequences:** Student receives two (or more) identical warning emails. Trust erodes. "One per crossing" semantics broken.

**Narrowing window:** The inserting transaction here is implicit single-statement autocommit. If the PK were `(course_id, student_id)` with separate tracking of closed crossings, it would self-serialize. As-is, only an app-level advisory lock or `INSERT ... ON CONFLICT DO NOTHING` (on a uniqueness excluding the timestamp) would fix it.

---

### 4. Multi-instance deployment breaks silently (in-memory singletons)

**Severity:** Critical (if/when scaled; documented for the record)
**Files:**
- `src/backend/services/qr-service.js:5` — `activeLoops` Map
- `src/backend/services/socket-service.js:7` — `io` singleton + rooms
- `src/backend/middleware/rate-limiter.js` — default express-rate-limit memory store

The deployment is currently single-instance on Render, but the code has no guard against running multiple copies. If Render scales to 2 instances (or during a rolling deploy overlap):

**`activeLoops` scenario:**
1. Instructor hits `POST /sessions/:id/start` on instance A. `activeLoops` on A holds the interval. A emits `qr:refresh` via its Socket.IO.
2. Instructor's Socket.IO connection is load-balanced to instance B. B has **no Socket.IO room** for this session (room state is per-instance unless Socket.IO adapter is Redis/Postgres). Instructor sees no QR updates.
3. Even polling (`GET /sessions/:id/qr`) works because `qr_tokens` rows are in the DB — but real-time is dead.

**Orphan cleanup scenario (see also finding #5):**
1. Instance A is running with live session X. Instance B starts up (Render scale-up or rolling deploy).
2. Instance B runs `db.update(sessions).set({status:'closed'}).where(status='active')` at server.js:108 — closes session X belonging to instance A.
3. Instance A's `setInterval` keeps generating `qr_tokens`, but the session is now `closed` in DB. Scans still pass QR validation (qr-validator only checks `qr_tokens.expiresAt`, not `sessions.status`), but attendance records accumulate for a "closed" session. Report generation behavior becomes inconsistent.

**Rate limiter scenario:**
Each instance has its own memory store. Effective login-limit becomes `5 × instance_count` per 10 minutes per IP. Low severity but defeats the security control.

**What protects:** Nothing in code. The `render.yaml` presumably pins instance count to 1, but that is deployment config, not a code invariant.

**Consequences:** Silent correctness failure the day scaling is enabled. Given the project's growth plan (Render + Neon), this is a landmine.

---

### 5. Orphan session cleanup races across instances / deploys

**Severity:** High
**File:** `src/backend/server.js:108`

```js
db.update(sessions).set({ status: 'closed', actualEnd: new Date() })
  .where(eq(sessions.status, 'active'))
```

This runs unconditionally at every boot. The comment says "Close any sessions left in 'active' state from a previous server instance" — but it cannot distinguish "my own previous crashed instance" from "my peer instance running right now."

**Interleaving (rolling deploy):**
1. Instance A is live at t0, serving session X (`status='active'`).
2. Render starts instance B (rolling deploy: new version up, then old one drains).
3. Instance B runs startup cleanup at t0+10s: closes session X.
4. Instance A's `setInterval` for session X continues, inserting `qr_tokens` with `expiresAt = now+25s`.
5. Students scanning session X succeed at qr-validator (token still in DB, not expired), but the session row says `closed`, `actualEnd` set. Attendance rows are written against a "closed" session. `emitAttendanceUpdate` broadcasts via instance A's Socket.IO — instructor may see counter update while "Session ended" banner is already shown (depending on frontend logic when `session:closed` arrives).
6. When instance A drains, stopRefreshLoop never runs for session X (no graceful shutdown hook; see `server.js` — there is no `SIGTERM` handler clearing intervals). Interval leaks until process exits. `emitSessionClosed` is never broadcast because the DB update by instance B didn't emit anything.

**What protects:** Nothing. There is no "instance_id" or "last_heartbeat" on sessions.

**Consequences:** Active sessions misrepresented as closed; attendance written to "closed" sessions (report queries that filter on `status='closed'` will pick them up, which may or may not be the intent); no graceful session termination during deploys.

---

### 6. QR refresh overlap on slow DB

**Severity:** Medium
**File:** `src/backend/services/qr-service.js:62-69`

```js
const interval = setInterval(async () => {
  try {
    const token = await generateQrToken(sessionId, course);
    onRefresh(token.payload, token.expiresAt);
  } catch (err) { ... }
}, course.qrRefreshIntervalSeconds * 1000);
```

`setInterval` schedules ticks regardless of whether the prior `async` body has finished. With `qrRefreshIntervalSeconds=25` and a Neon cold-start (free tier — connection pool may stall for seconds), the DB `INSERT INTO qr_tokens` can take >25s.

**Interleaving:**
1. Tick 1 at t=0: `generateQrToken` awaits INSERT. DB latency = 30s.
2. Tick 2 at t=25s fires while tick 1 is still awaiting. Tick 2 starts its own INSERT.
3. Tick 1 completes at t=30s: inserts token A (payload based on `ts=0ms`).
4. Tick 2 completes at t=30.5s: inserts token B (payload based on `ts=25000ms`).
5. Both are emitted via `onRefresh`. Clients receive out-of-order token updates. `getCurrentToken` orders by `generatedAt DESC`, so HTTP polling will pick whichever was inserted last (likely token B), but Socket.IO clients may render token A over token B if A's emit arrives second (which it will, because its await returned later).

**What protects:** Nothing directly. The `payload` UNIQUE constraint would fail only if two ticks produced the same payload (same `ts` ms), which is near-impossible but theoretically possible on slow systems.

**Consequences:** Students can briefly see a "fresh" QR that is actually stale; two valid tokens exist in DB overlapping; HTTP polling and Socket.IO disagree about "latest."

**Note:** The prior session's report claims "QR refresh setInterval with cleanup" is handled — cleanup on stop is fine (finding confirms `stopRefreshLoop` clears the interval), but overlap of ticks during operation is not addressed.

---

### 7. Prior QR token remains valid alongside new issuance

**Severity:** Medium
**Files:** `src/backend/services/qr-service.js:33` (issuance), `src/backend/validators/qr-validator.js:27-34` (validation)

Each call to `generateQrToken` inserts a new row with `expiresAt = now + qrRefreshIntervalSeconds`. No UPDATE to prior rows. The validator looks up by `payload` + `expiresAt >= now` — so **all previously-issued tokens for a session remain valid until their individual TTL elapses.**

**Scenario:**
1. At t=0: token A issued, `expiresAt=25s`. UI displays.
2. At t=25s: token B issued, `expiresAt=50s`. UI replaces A with B (via Socket.IO `qr:refresh`).
3. At t=25.5s: student scans a photo of token A taken earlier. qr-validator finds A in DB, `expiresAt(25s) < now(25.5s)` — **A is expired, scan fails**.

OK, so the TTL-based expiry does work at the boundary. But: because `setInterval` may tick slightly late (event-loop backpressure), and because `generateQrToken` sets `expiresAt = now + 25s` inside its own await (after the DB round-trip, which can be hundreds of ms), the actual overlap between A and B in the DB is `refresh_jitter + db_latency` — which can easily be 200-500ms on free-tier Neon.

**Interleaving:**
1. At t=0.0: `generateQrToken` runs, DB INSERT of token A completes at t=0.3s with `expiresAt = 25.3s`.
2. `setInterval` fires at t=25.0s. `generateQrToken` runs, DB INSERT of token B completes at t=25.3s with `expiresAt = 50.3s`.
3. Between t=25.0 and t=25.3, **both A and B are valid**. A student who scans a 1-second-old photo of token A at t=25.2 succeeds against A even though B is already on screen.

**What protects:** Individual `expiresAt` TTL eventually invalidates A. But the overlap is real and grows with DB latency.

**Consequences:** The anti-screenshot property of dynamic QR is weakened by a small window. Not a one-way compromise, but the stated design ("fresh QR every 25s") implies zero overlap.

**Fix direction (out of scope):** On new issuance, `UPDATE qr_tokens SET expires_at = now() WHERE session_id = $1 AND token_id != $new` in the same transaction. Or validate against `SELECT ... WHERE generated_at = (SELECT MAX(generated_at) ...)`.

---

### 8. Missing transaction — override UPSERT + audit log

**Severity:** Medium
**File:** `src/backend/controllers/override-controller.js:44-77`

The attendance UPSERT (lines 44-61) and the `auditLog` INSERT (lines 64-77) run as two independent autocommit statements. No `db.transaction(...)` wraps them.

**Interleaving / failure mode:**
- Attendance UPDATE/INSERT succeeds.
- Process crashes (OOM, Render killed, DB connection reset) before the auditLog INSERT lands.
- Attendance row is persisted with no audit record, violating the invariant "every override is audited" (documented in the design doc and asserted by the append-only trigger on audit_log, which is a write-prevention mechanism — not a write-guarantee).

**What protects:** Nothing. Drizzle's per-statement autocommit means each `.update()` / `.insert()` is its own transaction.

**Consequences:** Audit gaps. Regulatory / academic-integrity concern: an instructor's override action cannot be proven if the audit log entry is missing. The scan pipeline has the same concern — see finding #9.

**Note:** `verifyEmail` in `auth-controller.js:257-274` correctly uses a transaction. This demonstrates the team knows how; the pattern just wasn't applied consistently to override/scan flows.

---

### 9. Missing transaction — scan attendance INSERT + audit INSERT

**Severity:** Medium
**Files:**
- `src/backend/controllers/scan-controller.js:47-63` (attendance INSERT)
- `src/backend/validators/scan-verifier.js:55-71` (audit INSERT in `finally`)
- `src/backend/validators/audit-logger.js:19-22` (errors swallowed)

The scan flow is:
1. `verifyScan` runs, and in its `finally` block calls `logAudit({...})` — this writes to `audit_log`.
2. Then back in `scan-controller`, on success, `db.insert(attendance)` writes the attendance row.

So the order is actually **audit first, then attendance**. This is better than the override case (audit at least exists if attendance succeeds), but:

- If the process crashes between the audit INSERT and the attendance INSERT: `audit_log` shows `result='success'` for a scan attempt, but no attendance row exists. Report queries show the student as `absent`. The audit log contradicts the attendance record.
- `audit-logger.js` catches and **swallows** its own errors (line 19-22: `console.error`, no rethrow). So if the audit INSERT silently fails (connection blip, disk full), the scan still proceeds and records attendance with no audit trail.

**What protects:** Nothing. Two separate autocommit statements, no linkage.

**Consequences:** Partial persistence (audit without attendance, or attendance without audit) is reachable via process crash or audit-write failure. The design asserts "audit always runs" but the `try/catch` in audit-logger breaks that guarantee silently.

---

### 10. Device binding TOCTOU on first login

**Severity:** Low
**File:** `src/backend/controllers/auth-controller.js:162-175`

```js
if (user.role === 'student' && deviceFingerprint) {
  const [student] = await db.select().from(students).where(...).limit(1);
  if (student && !student.deviceFingerprint) {
    await db.update(students).set({ deviceFingerprint, deviceBoundAt: new Date() })...
  }
}
```

Read `deviceFingerprint`, then conditionally UPDATE. Not atomic.

**Interleaving:**
1. Attacker scripts two simultaneous POSTs to `/api/auth/login` with valid credentials from device X and device Y. Credentials are correct (they know the password).
2. Request X: SELECT → `deviceFingerprint=null`. Plans UPDATE with `X`.
3. Request Y: SELECT → `deviceFingerprint=null` (X hasn't committed yet). Plans UPDATE with `Y`.
4. Both UPDATEs run unconditionally (no WHERE guard on the current value). The second one wins: device `Y` is bound.

**What protects:** Nothing. The UPDATE has no `WHERE device_fingerprint IS NULL` guard.

**Consequences:** In a realistic scenario, a student could register from their preferred device but a colleague racing to login from a different device could bind that device instead. Narrow window (only fires while `deviceFingerprint IS NULL`), but doesn't require compromise — just two logins landing within a few ms.

**Fix direction:** `UPDATE students SET device_fingerprint = $1, device_bound_at = now() WHERE user_id = $2 AND device_fingerprint IS NULL`.

---

### 11. Re-enrollment race surfaces as 500 instead of 409

**Severity:** Low
**File:** `src/backend/controllers/course-controller.js:68-92`

`executeEnrollment` reads existing row, branches to re-enroll (UPDATE `removedAt=null`), already-enrolled (409), or fresh INSERT.

**Interleaving:**
1. Student double-clicks "Enroll." Requests A and B land together.
2. Both SELECT → no row.
3. Both branch to `INSERT INTO enrollments`.
4. Enrollments has composite PK `(courseId, studentId)`. Second INSERT fails with `23505`. Error is uncaught → 500 to client.

**What protects:** Composite PK guarantees no duplicate rows (data integrity fine).

**Consequences:** User sees "Internal server error" on an innocuous double-click; the actual outcome (enrollment happened, 200 returned to request A) is fine, but the UX is poor. Could be caught with the same `23505` handler pattern used in `scan-controller.js:59`.

---

## Cross-Cutting Observations

### A. connect-pg-simple concurrency

The `connectPgSimple` store uses the same `pg.Pool` as Drizzle and runs `SELECT/INSERT/UPDATE` on the `session` table it auto-creates. Each request's session read and write is a single SQL statement (autocommit). For this app's session payload (small: `userId`, `email`, `name`, `role`), there is no read-modify-write race within a single request. The `req.session.regenerate` in `login` (auth-controller.js:183) uses the store's own API which internally DELETEs the old session and INSERTs a new one — this is done in library code, audited to be safe. **No finding here.**

### B. Audit log append-only protection

The DB trigger (`drizzle/0001_sudden_scalphunter.sql:44-52`) rejects UPDATE and DELETE on `audit_log`. INSERT-only is thread-safe by construction — no write batching, no `ON CONFLICT`. Each audit entry is one statement. **Verified safe** (but see finding #9 for the "audit might be missing" angle).

### C. `io` singleton initialization

`socket-service.js:7` uses a module-level `let io = null;`. Initialized once from `server.js:97` before the HTTP server starts accepting connections. No race on initialization because Node.js modules are resolved single-threadedly at import. **Verified safe.**

### D. `activeLoops` Map

Within a single Node process, the event loop serializes all JS code. `Map.set` and `Map.get` are atomic with respect to other JS frames. Within `startRefreshLoop`, the `stopRefreshLoop(sessionId)` call synchronously cleans up before `activeLoops.set`. **Verified safe within one process** — but see finding #4 for multi-instance.

### E. Bcrypt cost

`BCRYPT_ROUNDS` (likely 10-12) makes login CPU-bound. On a single-CPU Render instance, concurrent logins block the event loop. Not a correctness issue but a throughput concern that can interact with rate limiting timing. No finding.

---

## Conclusion

QR-Guard's concurrency posture is **acceptable for single-instance dev/demo but has real bugs that manifest under realistic UX patterns** (double-click start, concurrent override+scan, threshold notification on both scan and override paths). The data layer mostly saves the app from catastrophic corruption because of the UNIQUE index on attendance and the append-only trigger on audit_log — but "mostly" includes uncaught `23505` errors surfaced as 500s, and duplicate warning emails that the PK design actively enables.

**The most important fixes, ordered by ROI:**

1. **Finding #3** (duplicate warning emails) — visible to end users, eroding trust. Fix by de-duping at app level before INSERT, or changing the PK to not include timestamp and adding a separate "recovered" flag.
2. **Finding #2** (override 500 on race) — occasional support tickets, easy to reproduce. Fix by catching `23505` in override-controller the same way scan-controller does.
3. **Finding #1** (startSession double-start) — common via double-click. Fix by conditional UPDATE (`WHERE status='scheduled'`).
4. **Finding #4 + #5** (multi-instance landmine) — not exploitable today, but the whole deployment strategy fails silently the moment scaling is turned on. Document the single-instance invariant or add Socket.IO Redis adapter + remove unconditional orphan cleanup.
5. **Findings #8 + #9** (missing transactions) — academic-integrity exposure. Wrap both override and scan in `db.transaction(async tx => { ... })`.

Findings #6, #7, #10, #11 are worth fixing but less user-visible.

**Total: 11 findings.** The target list suggested 10 areas to examine; findings cover all of them, with the Socket.IO room race mostly mitigated by the prior session's auth work (confirmed in `socket-service.js:60-76`).
