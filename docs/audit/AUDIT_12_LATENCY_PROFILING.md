# AUDIT 12: Latency Profiling

**Date**: 2026-04-18
**Scope**: All 31 HTTP endpoints + Socket.IO `join-session` handler
**Backend**: Node.js 20 + Express 5 + `pg` Pool (size 10, default) + Drizzle ORM
**Database**: PostgreSQL 17 on Neon (serverless, connection-pooled, cold-start possible)
**Deploy target**: Render.com US East Ohio → Neon US East (co-located, but a single TCP hop per query)
**Assumed network latency**: Neon p50 ~30 ms per round trip from Render's Ohio region; p95 ~60 ms; p99 ~100 ms (cold-path or WAL pressure). Warm pool: 1–3 ms. We use **30 ms median / 60 ms p99** as the round-trip unit in estimates below.
**Method**: Static analysis of route handlers, validators, services, and drizzle migrations. No live profiling.

Prior work already fixed: N+1 in `getPerSessionReport` and `exportCsv` (bulk `inArray` pre-fetch), per-student bulk `inArray` in `getPerStudentReport`. Docs claim `audit_log_target_idx` was added — **this is not true in the actual schema** (see finding L-06).

---

## 1. Endpoint Latency Table

| # | Method | Path | DB Queries | External | Est. p50 | Est. p99 | Serial? | Notes |
|---|---|---|---|---|---|---|---|---|
| 1 | POST | `/api/auth/register` | 1 select + 1 tx (2 writes) + 1 insert = **4 RT** | SMTP send (sync) | ~350 ms | ~900 ms | Yes | bcrypt hash @ rounds 12 ≈ 200–300 ms (CPU). Email send blocks response (see L-01). |
| 2 | POST | `/api/auth/login` | 1 select (user) + 1 select (student, conditional) + 0–1 update + session regenerate (2 store ops: destroy + insert) = **3–5 RT** | — | ~280 ms | ~700 ms | Yes | bcrypt.compare ≈ 200–300 ms. connect-pg-simple `req.session.regenerate` does 2 DB ops. See L-02. |
| 3 | POST | `/api/auth/logout` | 1 DB (session destroy in pg store) = **1 RT** | — | ~30 ms | ~70 ms | — | |
| 4 | POST | `/api/auth/verify-code` | 1 select + 1 select + 1 tx (2 updates) = **3 RT serial + 1 tx** | — | ~120 ms | ~300 ms | Yes | Two serial selects could be parallelized (but second depends on first's `user.userId`). |
| 5 | GET | `/api/auth/verify-email` | 1 select + 1 tx (2 updates) = **2 RT + 1 tx** | — | ~90 ms | ~220 ms | Yes | Also used for `/verify-rebind`. |
| 6 | POST | `/api/auth/forgot-password` | 1 select + (if user: 1 update + 1 insert) = **3 RT** | SMTP send (sync) | ~200 ms | ~600 ms | Yes | Token generation is 32 bytes crypto (<1 ms). |
| 7 | POST | `/api/auth/resend-verification` | 1 select + (if user: 1 update + 1 insert) = **3 RT** | SMTP send (sync) | ~200 ms | ~600 ms | Yes | Same pattern as forgot-password. |
| 8 | POST | `/api/auth/reset-password` | 1 select + 1 tx (2 updates) = **2 RT + 1 tx** | — | ~280 ms | ~700 ms | Yes | bcrypt.hash @ rounds 12. |
| 9 | POST | `/api/auth/request-rebind` | 1 select (user) + 1 insert = **2 RT** | SMTP send (sync) | ~150 ms | ~400 ms | Yes | |
| 10 | GET | `/api/auth/me` | 1 select = **1 RT** | — | ~30 ms | ~70 ms | — | |
| 11 | POST | `/api/courses` | 1 select (uniqueness in enrollment-code) + 1 insert + 1 bulk insert (sessions) = **3 RT + N sessions** | — | ~120 ms | ~400 ms | Yes | `generateSessions` can create 50–100 rows for a 16-week semester → large single `INSERT … VALUES (…), …`. Payload size limited by `express.json({limit:'10kb'})` on input only. |
| 12 | GET | `/api/courses` | Instructor: **1 RT**; Student: **1 RT** | — | ~35 ms | ~80 ms | — | Instructor path lacks index on `courses.instructor_id` (see L-03). Student path: composite PK `(course_id, student_id)` — query filters by `student_id` alone, so PK index is NOT usable, seq-scan on enrollments (see L-04). |
| 13 | GET | `/api/courses/:id` | 1 select (course) + 1 select (auth: instructor-owned OR enrollment) + 1 select (sessions) = **3 RT** | — | ~100 ms | ~250 ms | **No — parallelizable** | Course + auth check + sessions are independent after we confirm course exists. Could `Promise.all` the second and third. |
| 14 | PUT | `/api/courses/:id` | 1 select (ownership) + 1 update + optional enrollment-code regen (loop with retries) = **2–4 RT** | — | ~80 ms | ~250 ms | Yes | `generateEnrollmentCode` may do up to 10 retries if collision. |
| 15 | POST | `/api/courses/enroll` (by-code) | 1 select (course by code) + 1 select (existing enrollment) + 1 insert/update = **3 RT** | — | ~100 ms | ~250 ms | Yes | `enrollment_code` IS uniquely indexed (good). |
| 16 | POST | `/api/courses/:id/enroll` | 1 select (course id+code) + 1 select (existing) + 1 insert/update = **3 RT** | — | ~100 ms | ~250 ms | Yes | Same cost as #15. |
| 17 | DELETE | `/api/courses/:id/students/:studentId` | 1 select (ownership) + 1 select (enrollment) + 1 update = **3 RT** | — | ~100 ms | ~250 ms | Yes | |
| 18 | GET | `/api/courses/:id/students` | 1 select (ownership) + 1 select (enrolled w/ 2 joins) + **1 big aggregate query** (`calculateAllAttendancePcts`) = **3 RT** | — | ~120 ms | ~400 ms | Yes | Aggregate does a `CROSS JOIN` sessions × enrollments + LEFT JOIN attendance — can be heavy for large cohorts (see L-07). |
| 19 | POST | `/api/courses/:id/sessions` | 1 select (ownership) + 1 insert = **2 RT** | — | ~60 ms | ~140 ms | Yes | |
| 20 | PATCH | `/api/courses/:id/sessions/:sessionId` | 1 select (ownership) + 1 update = **2 RT** | — | ~60 ms | ~140 ms | Yes | |
| 21 | POST | `/api/sessions/:id/start` | 1 select (session) + 1 select (course ownership) + 1 update + 1 `generateQrToken` insert = **4 RT** | — | ~140 ms | ~350 ms | Yes | First two selects are parallelizable (both need only URL param). |
| 22 | POST | `/api/sessions/:id/stop` | 1 select + 1 select + 1 update = **3 RT** | — | ~100 ms | ~250 ms | Yes | |
| 23 | GET | `/api/sessions/:id/qr` | 1 select (session) + 1 select (auth check) + 1 select (current token) = **3 RT** | — | ~100 ms | ~250 ms | Yes | Session + auth could be parallel. |
| 24 | POST | `/api/sessions/:id/override` | 1 select (session) + 1 select (course ownership) + 1 select (existing) + 1 insert/update + 1 insert (audit) + `checkThresholdAndNotify` (see below) = **5 RT + threshold chain** | SMTP (conditional) | ~250 ms | ~1200 ms | Yes | `checkThresholdAndNotify` fires synchronously: +4–6 RT + possible SMTP. See hot path §2.8. |
| 25 | **POST** | **`/api/scan`** | See hot path §2.1 = **6–7 RT** | **ip-api.com** (3 s timeout, FAIL-OPEN) | ~280 ms warm / **up to 3.3 s cold** | ~3.5 s | Yes | Most critical path. See §2.1. |
| 26 | GET | `/api/me/attendance` | 1 select (enrolled courses) + **N × `calculateAttendancePct`** (N = enrolled course count) = **1 + N RT** | — | ~100 ms (N=3) | ~400 ms (N=6) | Yes — **N+1 pattern** | Loop over enrolled courses, one query each. See §2.6. |
| 27 | GET | `/api/courses/:id/attendance` | 1 select (ownership) + 1 select (closed sessions) + 1 select (enrolled) + 1 bulk `inArray` select (attendance) = **4 RT** | — | ~150 ms | ~400 ms | Yes | N+1 already fixed. Four serial queries could be 2 tiers (`Promise.all(sessions, enrolled)` then attendance). |
| 28 | GET | `/api/courses/:id/attendance.csv` | 1 select (ownership) + 1 select (sessions) + 1 select (enrolled 3-way join) + 1 bulk attendance = **4 RT** + csv-stringify (CPU) | — | ~200 ms | ~800 ms | Yes | **Unbounded** — no `LIMIT` on sessions count or date range required. See L-05. |
| 29 | GET | `/api/courses/:id/attendance/student/:studentId` | 1 select (ownership or enrollment) + 1 select (sessions) + 1 bulk attendance + 1 select (student meta) + 1 `calculateAttendancePct` = **5 RT** | — | ~180 ms | ~500 ms | Yes | The student-meta select and the pct-calc are independent of each other — parallelizable. |
| 30 | GET | `/api/courses/:id/audit-log` | 1 select (ownership) + 1 select (session ids) + 1 select (page) + 1 select (count) = **4 RT** | — | ~150 ms | **~2 s (seq-scan)** | Yes | `target_id = ANY(...)` — **no index on `audit_log.target_id`** despite SCHEMA.md claim. See L-06. Page + count are parallelizable. |
| 31 | Socket | `socket.on('join-session')` | 1 select (session) + 1 select (course ownership OR enrollment) = **2 RT** | — | ~60 ms | ~150 ms | Yes | Runs once per room join; sessionMiddleware also hits pg store once per WS handshake. |

Totals: **31 HTTP endpoints + 1 WebSocket event**.

---

## 2. Hot-Path Analysis

### 2.1 `POST /api/scan` — the critical path

Pipeline layers (order is enforced by `scan-verifier.js`):

| Layer | What it does | DB RT | External | Notes |
|---|---|---|---|---|
| 1. QR token | `qr_tokens` select with `payload = ? AND expires_at >= now()` | 1 | — | Uses unique index on `payload` (fast). |
| 2. Device | `students` select `deviceFingerprint` by `userId` | 1 | — | PK lookup on `students.user_id`. |
| 3. IP | `fetch(ip-api.com/json/<ip>?fields=...)` with 3 s AbortController | 0 | **1** | **FAIL-OPEN** — if timeout or error, scan proceeds. Blocks request thread until timeout. |
| 4. GPS accuracy | Pure function (`<= 150 m && != 0`) | 0 | — | <1 ms. |
| 5. Geofence | `db.execute(ST_DWithin…)` with WKT cast + 15 m margin | 1 | — | PK lookup on `courses.course_id`. PostGIS operation on a single row is ~1 ms server-side. |
| 6. Audit log | `INSERT INTO audit_log` (always in `finally`) | 1 | — | Failure is swallowed (`console.error`). |
| — | `INSERT INTO attendance` (outside verifier, on success) | 1 | — | Unique index `attendance_session_student_idx` handles 23505. |
| — | Live counter broadcast: `SELECT COUNT(*) FILTER ... FROM enrollments LEFT JOIN attendance INNER JOIN sessions ...` | 1 | — | 3-way join per scan. Runs in try/catch — errors logged, not returned. |
| — | `checkThresholdAndNotify`: `calculateAttendancePct` + course select + warning-log select + (possibly) email + (possibly) instructor email | 3–6 | 0–2 SMTP | Synchronous in request. See §2.8. |

**Warm-path round trips:** 1 (QR) + 1 (device) + 1 (geofence) + 1 (audit) + 1 (attendance insert) + 1 (counter) + 3 (threshold) = **9 DB RT**, *plus* one external HTTP call to ip-api.com.

- p50 warm: 9 × 30 ms + 1 × ~150 ms ip-api = **~420 ms**.
- p99 warm: 9 × 60 ms + 1 × ~400 ms ip-api = **~940 ms**.
- **Cold-path worst case** (ip-api timing out, pool cold, Neon warming up): 9 × 100 ms + 3000 ms timeout = **~3.9 s**. Because the IP check is FAIL-OPEN, a slow ip-api **always** extends scan latency by up to the full 3 s `IP_API_TIMEOUT_MS`. See L-08.

**Finding L-08 (High — UX):** The scan pipeline awaits `ip-api.com` inline with `IP_API_TIMEOUT_MS = 3000` ms. On a flaky network or when ip-api throttles (free tier limits 45 req/min per source IP), every student's scan stalls up to 3 s before falling through to the rest of the pipeline. During a 180-student lecture starting at 09:00, scan bursts will exceed 45/min → all scans from that point stall on the full 3 s timeout. Mitigation: lower timeout to ~800 ms, or move the IP check **after** geofence (geofence is the authoritative Kuwait-location signal; ip-api is a defense-in-depth secondary), or fire-and-forget the IP check and only use its result to reject *async* in audit-only mode.

**Finding L-09 (Medium — Blocking):** `checkThresholdAndNotify` runs synchronously inside the scan request. Every successful scan in a course with at-risk students does another 3–6 DB queries + possibly 1–2 SMTP sends while the student's device is waiting for the response. This is work the instructor cares about, not the student — it should be queued or moved to the socket broadcast path (since the broadcast is already fire-and-forget).

### 2.2 Session page load (instructor view)

Initial page typically calls:

1. `GET /api/sessions/:id/qr` → 3 RT (~100 ms).
2. `GET /api/courses/:id/attendance` for live report → 4 RT (~150 ms).
3. `GET /api/courses/:id/students` for roster → 3 RT + aggregate (~120 ms).

All three are **serial in the browser** (not in the API). If the client fires them in parallel: total wall-clock ≈ max(~150 ms). If serial: ~370 ms. Frontend fetch order is not verified here — worth a client-side audit.

### 2.3 Instructor dashboard (`GET /api/courses` listing)

Single query: `SELECT * FROM courses WHERE instructor_id = ?`. One RT, ~30 ms p50.

**Finding L-03 (Medium — Index):** `courses.instructor_id` has no dedicated btree index. The FK constraint does NOT create one automatically in PostgreSQL. At current scale (say ≤500 courses total, with a unique instructor per ~20 courses), this seq-scans the entire courses table on every dashboard load. Cost is low in absolute terms (<5 ms at 500 rows) but grows linearly. Add `CREATE INDEX courses_instructor_idx ON courses(instructor_id);`.

### 2.4 Course detail page

`GET /api/courses/:id` → 3 RT, plus the UI typically follows up with `GET /api/courses/:id/students` and `GET /api/courses/:id/attendance`. Cumulative first-paint ≈ 4 + 3 + 4 = **11 RT** if serial = **~330 ms p50**. Could be cut to ~150 ms by parallelizing the three requests (already independent).

**Finding L-10 (Low — Serial-when-parallelizable):** In `getCourse` itself, the three queries (course fetch, auth check, sessions fetch) are serial. The auth check depends on `course.instructorId` or on a separate enrollment lookup, but the `sessions` fetch only needs `:id`. Reorder to `Promise.all([courseQuery, sessionsQuery])` then do the auth check on the already-fetched course row — saves ~30 ms p50.

### 2.5 Per-student report (`GET /api/courses/:id/attendance/student/:studentId`)

5 serial RT for ~180 ms p50. **Acceptable**. Two micro-optimizations:
- `student` meta and `calculateAttendancePct` are independent — parallelize for ~30 ms savings.
- If the frontend already has the student's name from the roster, the student-meta query is redundant.

### 2.6 Student self-view (`GET /api/me/attendance`)

```js
for (const c of enrolled) {
  const pct = await calculateAttendancePct(c.courseId, studentId);  // 1 RT each
  result.push({ ...c, attendancePct: pct });
}
```

**Finding L-11 (Medium — N+1):** Classic N+1. A student enrolled in 5 courses does 1 + 5 = 6 DB RTs. Should use `calculateAllAttendancePcts`-style query but keyed by `(course_id, student_id)` for a single student across all their courses, or `Promise.all` the loop so the RTs run in parallel (~30 ms instead of ~150 ms for N=5).

### 2.7 CSV export (`GET /api/courses/:id/attendance.csv`)

**Finding L-05 (Medium — Unbounded):**
- No `LIMIT` on number of sessions (a year-long course with 3 sessions/week = ~100 sessions).
- No `LIMIT` on number of enrolled students (could be 200+ for a large lecture).
- Worst case row count: 100 × 200 = **20,000 rows** in memory + CSV stringified in a single synchronous call (`csv-stringify/sync`). At ~100 bytes/row = 2 MB string allocation, plus the underlying JS objects (~20 MB). At this size, the endpoint may GC-stall the Node process for 50–200 ms, and the full HTTP body will take 1–2 s to serialize and stream.
- Date range filter (`from`/`to`) is optional — if a frontend omits it, the whole semester is exported every call.
- Client status/student filters are applied **in JS after** the DB query, so they don't reduce the underlying workload.

Mitigation: require `from`/`to`, cap to e.g. 14 days per call, paginate or stream (`csv-stringify` streaming variant), and push the `status`/`studentId` filter into the SQL WHERE clause.

### 2.8 `checkThresholdAndNotify` chain

Called by both `POST /api/scan` and `POST /api/sessions/:id/override`. On the critical path.

```
calculateAttendancePct                            → 1 RT (aggregate CTE)
SELECT * FROM courses WHERE course_id = ?        → 1 RT
SELECT * FROM warning_email_log WHERE ...         → 1 RT
If below threshold, no open crossing:
  INSERT INTO warning_email_log                   → 1 RT
  SELECT name, email FROM users                   → 1 RT
  getClosedSessionCount                           → 1 RT
  sendEmail                                        → SMTP (blocks)
  If absences ≥ 15%:
    SELECT name, email FROM users (instructor)    → 1 RT
    sendEmail                                      → SMTP (blocks)
```

Worst case: **7 DB RT + 2 SMTP sends**, all serial, all on the scan request path.

**Finding L-12 (High — Coupling):** SMTP is synchronous. A slow SMTP host (or AWS SES throttling) adds seconds to every scan that triggers a threshold crossing. Queue the notifications and respond to the scan first.

### 2.9 Login flow latency breakdown

```
1 RT: SELECT * FROM users WHERE email = ?
CPU:  bcrypt.compare(pw, hash)        → ~250 ms median at BCRYPT_ROUNDS=12
0–1 RT (conditional): UPDATE users on failure counter / on lockout reset
0–1 RT (conditional, student only): SELECT * FROM students
0–1 RT (conditional, student first-login): UPDATE students SET deviceFingerprint
2 RT: session.regenerate — connect-pg-simple does (1) destroy old sid + (2) insert new sid
```

- p50 successful login: ~250 ms bcrypt + 3 × 30 ms = **~340 ms**.
- p99: ~400 ms bcrypt + 3 × 60 ms = **~580 ms**.
- p99 with lockout reset path: **~650 ms**.

BCRYPT_ROUNDS=12 is appropriate for 2026 but it IS the dominant term; going to 11 would halve the bcrypt cost and is still well above the OWASP 2023 minimum of 10.

### 2.10 Register flow latency breakdown

```
1 RT:  SELECT userId FROM users WHERE email = ?
CPU:   bcrypt.hash(password, 12)       → ~250 ms median
tx (2 inserts): users + (students OR instructors)    → ~60 ms (serial inside tx)
1 RT:  INSERT INTO email_verification_tokens
SMTP:  sendVerificationCode             → network-dependent, often 200–800 ms
```

- p50: **~600 ms** (bcrypt + 3 RT + SMTP).
- p99: **~1.5 s** depending on SMTP.

**Finding L-01 (Medium — Blocking):** SMTP send is awaited in-line. User sits on the registration form for a full second waiting for Mailhog/SES. Queue it (or do it after responding); even a simple `setImmediate`-style fire-and-forget would work given the existing try/catch pattern.

### 2.11 Socket.IO `join-session`

```
1 RT: SELECT * FROM sessions WHERE session_id = ?
1 RT: SELECT * FROM courses (instructor check) OR SELECT * FROM enrollments (student check)
```

Plus the session-middleware pg store lookup during the WebSocket handshake (1 RT). So **3 RT total** on first connect, then 2 RT per subsequent `join-session` event. At a live lecture with 180 students joining within ~60 s, that's 180 × 3 = **540 RTs** funneled through the pg pool of size **10**. Even if each RT takes 30 ms, pool saturation queues this out to ~60 s of total wait.

**Finding L-13 (High — Pool sizing):** `config/database.js` uses the default `pg.Pool` max of **10** connections. On Render's starter tier this is adequate; on any scale (multi-instance or burst traffic), 10 is too small. A lecture burst (180 students scanning within the first 30 s after the QR appears) generates 180 × 9 DB RTs = **1620 RTs**, serialized through 10 connections, plus Socket.IO joins, plus session-middleware reads on every HTTP request. Explicit `max: 20` (or more, up to Neon's compute limit) + `connectionTimeoutMillis` + `idleTimeoutMillis` should be set.

---

## 3. Index Coverage Audit

Indexes that **exist** (migrations 0000–0002):

- `sessions_course_idx` on `(course_id, scheduled_start)` — good for course-detail sessions list.
- `attendance_session_student_idx` UNIQUE on `(session_id, student_id)` — good for scan insert + per-session/per-student joins.
- `attendance_student_idx` on `(student_id)` — good for per-student report.
- `audit_log_timestamp_idx` on `(timestamp)`.
- `audit_log_actor_idx` on `(actor_id)`.
- `qr_tokens_session_idx` on `(session_id, generated_at)` — good for `getCurrentToken`.
- `qr_tokens_payload` unique — good for QR validation (Layer 1).
- Various unique: `users.email`, `students.university_id`, `instructors.employee_id`, `courses.enrollment_code`.
- FKs create auto-indexes? **No** — PostgreSQL does not auto-index FKs.

Indexes that are **missing**:

| # | Missing index | Used by | Severity |
|---|---|---|---|
| L-03 | `courses(instructor_id)` | `listCourses` instructor path, `getCourseForInstructor`, ownership checks | Medium (scales linearly w/ total courses) |
| L-04 | `enrollments(student_id)` — standalone | `listCourses` student path, `getMyAttendance`, Socket.IO enrollment check | **High** (every student-side query seq-scans) |
| L-06 | `audit_log(target_id)` | `getAuditLog` (pagination + count queries) | **High** (table is append-only, grows forever; docs claim this exists, it doesn't) |
| L-14 | `email_verification_tokens(user_id, purpose, used_at)` partial | `forgotPassword`, `resendVerification` — `WHERE user_id=? AND purpose=? AND used_at IS NULL` | Low (table stays small; tokens expire in 24 h) |
| L-15 | `warning_email_log(course_id, student_id, recovered_above_at IS NULL)` partial | `checkThresholdAndNotify` "open crossing" lookup — runs on every scan | Medium (scan-path query) |
| L-16 | `sessions(course_id) WHERE status='closed'` partial | All report queries | Low (existing composite `(course_id, scheduled_start)` is usable for this; filter applied after) |

**Finding L-04 (High):** `enrollments` has composite PK `(course_id, student_id)`. A btree PK is only useful for queries that filter on the **leading** column(s). Queries filtering by `student_id` alone — `listCourses` student path, `getMyAttendance`, Socket.IO `canAccessSession` student check, the `calculateAllAttendancePcts` CROSS JOIN — cannot use the PK index and will seq-scan `enrollments`. At 10k total enrollments this is <5 ms, but it grows linearly and appears in the scan critical path (via Socket.IO join). Add `CREATE INDEX enrollments_student_idx ON enrollments(student_id) WHERE removed_at IS NULL;`.

**Finding L-06 (High — Documentation drift):** `docs/SCHEMA.md:170` declares `CREATE INDEX audit_log_target_idx ON audit_log(target_id);` and `docs/SESSION_REPORT_FULL.md:109` lists `audit_log target_id index` as a completed fix. **The migration does not create this index**, nor does `src/backend/db/schema/audit-log.schema.js` declare it (only `timestamp` and `actor_id` indexes are defined). The `getAuditLog` handler does:

```sql
SELECT * FROM audit_log WHERE target_id = ANY(${sessionIds}) ORDER BY timestamp DESC LIMIT ? OFFSET ?
SELECT COUNT(*) AS total FROM audit_log WHERE target_id = ANY(${sessionIds})
```

Both seq-scan. The audit table grows with every scan attempt (every pipeline run inserts one row, even rejected). A semester of a single 180-student course generates ~180 scans × 3 sessions/week × 15 weeks = **~8100 rows just for that course**, plus audit rows for other courses interleaved. After a year the seq-scan dominates.

---

## 4. Connection Pool & Cold-Start

- `pg.Pool` default `max: 10`. See L-13.
- Neon's serverless compute **auto-suspends after 5 min idle** (default free-tier setting). First request after suspend adds **~500–1500 ms** of Neon compute warm-up on top of query latency. Render Free tier also sleeps the server after 15 min — first hit after sleep adds ~30 s cold start.
- `pg.Pool` will reconnect transparently, but connection acquisition adds ~5 ms per request when the pool is full.
- session-middleware (`connect-pg-simple`) adds **1 DB RT per authenticated HTTP request** just to read the session row. This is not in any of the tables above. On a warm pool this is ~3 ms; on a cold burst it's another RT in the queue.

**Finding L-17 (Low — Cold start):** There is no `pool.on('error')` handler in `database.js`, so a Neon-side disconnect silently kills one connection but does not reset the pool. Under prolonged idle → Neon suspend → Render-side process still alive → first request finds stale connection, caller sees one failed request. Add a pool error handler and consider `keepAlive: true` on Pool config.

---

## 5. Quantitative Summary

- **Endpoints with external HTTP call**: 1 (`POST /api/scan` → ip-api.com). No other endpoint makes outbound HTTP calls during the request (SMTP is via nodemailer — separate TCP connection per call, effectively another external blocker on auth + threshold paths).
- **Endpoints that exceed 500 ms p99 in worst case**: `POST /api/scan` (up to 3.9 s cold), `POST /api/sessions/:id/override` (up to 1.2 s), `POST /api/auth/register` (~900 ms), `POST /api/auth/reset-password` (~700 ms), `POST /api/auth/login` (~700 ms), `GET /api/courses/:id/attendance.csv` (~800 ms warm, unbounded cold), `GET /api/courses/:id/audit-log` (~2 s due to seq-scan).
- **Endpoints with N+1 patterns still present**: `GET /api/me/attendance` (L-11). Others already fixed.
- **Endpoints with easily-parallelizable serial awaits**: `getCourse` (L-10), `getAuditLog` (page+count), `getPerStudentReport`, `startSession`, `stopSession`, `getQr`. Collective savings ~30 ms per request.
- **Missing indexes that hit scan critical path**: `enrollments(student_id)` via Socket.IO, `warning_email_log(course_id, student_id) WHERE recovered_above_at IS NULL` via threshold check, `audit_log(target_id)` via `getAuditLog` (not scan path but audit retrieval).
- **Scan pipeline**: **6 layers + 3 post-checks = up to 9 DB RTs + 1 external HTTP** in the worst warm case. The ip-api 3 s timeout is the single biggest contributor to p99 when ip-api is flaky.

---

## 6. Prioritized Recommendations

| # | Change | Effort | Expected win |
|---|---|---|---|
| 1 | Reduce `IP_API_TIMEOUT_MS` from 3000 → 800, and consider running the IP check in parallel with geofence (both are independent) | 10 min | Cuts scan p99 from ~3.9 s to ~1.2 s in degraded-ip-api conditions |
| 2 | Add `CREATE INDEX audit_log_target_idx ON audit_log(target_id);` (the index docs claim exists) | 5 min + migration | Cuts `getAuditLog` p99 from ~2 s to <100 ms as table grows |
| 3 | Add `CREATE INDEX enrollments_student_idx ON enrollments(student_id) WHERE removed_at IS NULL;` | 5 min + migration | Speeds Socket.IO join + student dashboard; scan-path indirect win |
| 4 | Queue SMTP sends (register, reset, threshold notifications) — respond to client first | 1 h | -500 ms to -2 s on all email-triggering endpoints |
| 5 | Queue `checkThresholdAndNotify` off the scan request thread | 1 h | -200 ms to -1 s on scan when thresholds cross |
| 6 | Raise `pg.Pool` max from 10 to 20 (Neon Starter supports this), add pool error handler and `keepAlive` | 15 min | Eliminates pool-queuing at lecture-start bursts |
| 7 | Bound CSV export: require `from`/`to`, cap window to 14 days, push `status`/`studentId` filters into SQL | 30 min | Caps memory at ~5k rows; predictable latency |
| 8 | Fix `getMyAttendance` N+1 with `Promise.all` (quick) or a single `calculateAttendancePctsForStudent(studentId)` aggregate (proper) | 20 min / 1 h | 5× speedup for multi-course students |
| 9 | Add `CREATE INDEX courses_instructor_idx ON courses(instructor_id);` | 5 min | Constant-time instructor dashboard regardless of total course count |
| 10 | `Promise.all` parallelizable selects in `getCourse`, `startSession`, `stopSession`, `getQr`, `getAuditLog` (page+count), `getPerStudentReport` | 1 h total | -30 ms per request |
| 11 | Lower `BCRYPT_ROUNDS` 12 → 11 | 1 line + doc note | Halves bcrypt CPU time (~125 ms saved on login, register, reset) |

---

## Appendix: Paths referenced

- `/home/ahmad/Downloads/csis/QR-Guard/src/backend/server.js`
- `/home/ahmad/Downloads/csis/QR-Guard/src/backend/config/database.js`
- `/home/ahmad/Downloads/csis/QR-Guard/src/backend/config/constants.js`
- `/home/ahmad/Downloads/csis/QR-Guard/src/backend/controllers/scan-controller.js`
- `/home/ahmad/Downloads/csis/QR-Guard/src/backend/controllers/auth-controller.js`
- `/home/ahmad/Downloads/csis/QR-Guard/src/backend/controllers/course-controller.js`
- `/home/ahmad/Downloads/csis/QR-Guard/src/backend/controllers/session-controller.js`
- `/home/ahmad/Downloads/csis/QR-Guard/src/backend/controllers/report-controller.js`
- `/home/ahmad/Downloads/csis/QR-Guard/src/backend/controllers/override-controller.js`
- `/home/ahmad/Downloads/csis/QR-Guard/src/backend/validators/scan-verifier.js`
- `/home/ahmad/Downloads/csis/QR-Guard/src/backend/validators/ip-validator.js`
- `/home/ahmad/Downloads/csis/QR-Guard/src/backend/validators/geofence-checker.js`
- `/home/ahmad/Downloads/csis/QR-Guard/src/backend/validators/audit-logger.js`
- `/home/ahmad/Downloads/csis/QR-Guard/src/backend/services/notification-service.js`
- `/home/ahmad/Downloads/csis/QR-Guard/src/backend/services/qr-service.js`
- `/home/ahmad/Downloads/csis/QR-Guard/src/backend/services/attendance-calculator.js`
- `/home/ahmad/Downloads/csis/QR-Guard/src/backend/services/socket-service.js`
- `/home/ahmad/Downloads/csis/QR-Guard/src/backend/db/schema/audit-log.schema.js`
- `/home/ahmad/Downloads/csis/QR-Guard/src/backend/db/schema/enrollment.schema.js`
- `/home/ahmad/Downloads/csis/QR-Guard/src/backend/db/schema/course.schema.js`
- `/home/ahmad/Downloads/csis/QR-Guard/drizzle/0000_outstanding_psynapse.sql`
- `/home/ahmad/Downloads/csis/QR-Guard/drizzle/0001_sudden_scalphunter.sql`
- `/home/ahmad/Downloads/csis/QR-Guard/drizzle/0002_known_aqueduct.sql`
- `/home/ahmad/Downloads/csis/QR-Guard/docs/SCHEMA.md` (stale index claim at line 170)
- `/home/ahmad/Downloads/csis/QR-Guard/docs/SESSION_REPORT_FULL.md` (stale fix claim at line 109)
