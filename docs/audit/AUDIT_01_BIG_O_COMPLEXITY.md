# QR-Guard Big-O / Algorithmic Complexity Audit

**Date:** 2026-04-18
**Auditor:** Claude Opus 4.7 (1M context) — read-only
**Scope:** All backend route handlers, controllers, services, validators under `src/backend/`
**Baseline:** `docs/SESSION_REPORT_FULL.md` (65 fixes already applied across 8 audit rounds)
**Objective:** Identify NEW complexity bottlenecks not already listed in the session report, measured against a realistic campus scale (n = students per course ≤ 300, m = sessions per semester ≤ 45, k = courses per instructor ≤ 10, u = enrolled courses per student ≤ 8).

---

## Scope Note

SESSION_REPORT_FULL.md lists the following complexity fixes as already applied. They are EXCLUDED from this audit:

- N+1 queries in `getPerSessionReport` and `exportCsv` (bulk `inArray()` fetch) — fixed
- CSV export N+1 — fixed
- `calculateAllAttendancePcts` shifted to SQL CTE with COALESCE — fixed
- Notification threshold one-per-crossing semantics — fixed
- QR token periodic cleanup every 10 min — fixed
- Orphaned active sessions auto-closed on restart — fixed
- audit_log target_id index — **claimed fixed in SESSION_REPORT_FULL.md but NOT present in code or migrations (see Finding 02)**

This audit only reports findings that are either NEW or show regressions against the session report's claims.

---

## Summary Table

| # | Severity | File:Line | Description | Complexity |
|---|----------|-----------|-------------|------------|
| 01 | **HIGH** | `report-controller.js:205-221` | `getMyAttendance` calls `calculateAttendancePct` sequentially per enrolled course (JS-side N+1 vs SQL CTE) | O(u) sequential DB round-trips per student self-view |
| 02 | **HIGH** | `audit-log.schema.js:16-19` + `report-controller.js:245-255` | `getAuditLog` filters `WHERE target_id = ANY(sessionIds)` but **no index exists on `audit_log.target_id`** — session report claim unfulfilled | O(N) full scan of audit_log per page load, where N = total rows in audit_log (grows unbounded across all courses) |
| 03 | **HIGH** | `report-controller.js:239-241` | `getAuditLog` builds `sessionIds` array by scanning ALL sessions for the course with no LIMIT; passes the full array into the `ANY(...)` filter | O(m) memory + O(m) query-plan complexity. At end of semester m≈45; at multi-year retention grows unbounded |
| 04 | **MEDIUM** | `attendance-calculator.js:46-76` | `calculateAllAttendancePcts` uses `CROSS JOIN` between enrollments and sessions, producing n×m intermediate rows before the LEFT JOIN + GROUP BY | O(n·m) intermediate rows per roster render. At 300 students × 45 sessions = 13,500 rows |
| 05 | **MEDIUM** | `scan-controller.js:67-80` | After every successful scan, a 3-way JOIN runs (`enrollments ⋈ attendance ⋈ sessions`) to compute live counter | O(n) per scan. For a 300-student session with 300 concurrent scans, this is 300 live-counter queries each doing an n-row aggregation (~90K row-reads/session) |
| 06 | **MEDIUM** | `notification-service.js:20-100` → `attendance-calculator.js:13-37` | `checkThresholdAndNotify` runs the full CTE over ALL closed sessions of the course on EVERY scan AND EVERY override | O(m) per scan where m = closed sessions. The CTE is rebuilt from scratch even though exactly one student's denominator didn't change |
| 07 | **MEDIUM** | `course-controller.js:213-218` | `getCourse` returns ALL sessions for a course with no LIMIT and no pagination | O(m) rows per detail page load. At end of semester, plus any ad-hoc sessions added, can reach 60+ rows per request |
| 08 | **MEDIUM** | `course-controller.js:152-158` | `listCourses` for instructor has no LIMIT. A prolific instructor across multiple semesters accumulates courses forever (no archive) | O(k_total) unbounded over instructor's career |
| 09 | **MEDIUM** | `session-generator.js:28-68` | `generateSessions` has no upper cap on output size. User-controlled `weeklySchedule.length` × `(semesterEnd - semesterStart)/7` weeks. A malicious/fat-fingered 7-day schedule with a 2-year semester range produces ~730 inserts | O(slots × weeks), unbounded by user input |
| 10 | **MEDIUM** | `report-controller.js:49-71` + `136-192` | `getPerSessionReport` and `exportCsv` build `O(n·m)` response objects in JS memory (even though the DB fetch is now bulk) | O(n·m) memory + serialization. At 300 students × 45 sessions = 13,500 row objects per response |
| 11 | **LOW** | `qr-service.js:107-113` + `qr-token.schema.js` | `cleanupExpiredTokens` does `DELETE WHERE expires_at < now() - INTERVAL '1 hour'` but **no index on `expires_at`** | O(T) full scan every 10 min where T = rows in qr_tokens. At 50 concurrent sessions × 24 tokens/hour × 1h retention ≈ 1,200 rows — acceptable today |
| 12 | **LOW** | `geofence-checker.js:16-34` + `courses.geofence_center` | `geofence_center` is stored as `text` not `geography`; `ST_GeogFromText()` is cast per-request. No GiST spatial index possible on text column | O(1) because the query also filters by `course_id` (PK lookup → 1 row), so only one cast runs. Noted for future pattern correction |
| 13 | **LOW** | `0000_outstanding_psynapse.sql:29-35` (enrollments) + `course-controller.js:162-178` | `enrollments` has composite PK `(course_id, student_id)`; no standalone index on `student_id`. Student's `listCourses` filters by `studentId` only | O(n_all_enrollments) seq scan for student → courses lookup. Mitigated by the `attendance_student_idx` NOT existing on enrollments; Drizzle default is PK-only |
| 14 | **LOW** | `enrollment-code.js:14-34` | `generateEnrollmentCode` retries on collision but with no jitter; collision check is a full SELECT per retry | O(R) where R=ENROLLMENT_CODE_MAX_RETRIES. Acceptable (alphabet^6 = 32^6 collision space) |
| 15 | **LOW** | `socket-service.js:66-76` | `join-session` does a `canAccessSession` DB call on every join event; no per-socket caching | O(1) per join but socket.io reconnects cause repeat calls. No rate limit on join-session |

**Total: 15 findings** (3 High, 7 Medium, 5 Low). Most of the codebase is already well-bounded — prior audits did effective work.

---

## Per-Finding Detail

### Finding 01 — getMyAttendance does sequential N+1 on calculateAttendancePct

**File:** `src/backend/controllers/report-controller.js:205-221`
**Severity:** HIGH

**Root cause.** Student self-view iterates each enrolled course and `await`s `calculateAttendancePct` one-by-one. Each call executes the full CTE from `attendance-calculator.js:16-33`.

**Proof:**
```js
// report-controller.js:214-218
const result = [];
for (const c of enrolled) {
  const pct = await calculateAttendancePct(c.courseId, studentId);
  result.push({ ...c, attendancePct: pct });
}
```

**Complexity analysis.** u = enrolled courses for this student (typically 4–8). Each `calculateAttendancePct` is one round-trip doing a CTE over the course's sessions. Total: O(u) round-trips with RTT-dominated latency. At u=8 and 20 ms per round-trip over Neon (Render ↔ Neon cross-region), that's 160 ms just on network.

**Note re: session report.** The report lists "N+1 queries in reports fixed via bulk inArray" — that fix applied to `getPerSessionReport` and `exportCsv`, not to `getMyAttendance`. This handler is still N+1 by construction (no bulk variant of `calculateAttendancePct` was added for the student-all-courses case).

**Recommended fix.** Add `calculateAttendancePctsForStudent(studentId, courseIds[])` that runs one CTE grouping by `course_id`. Collapses u queries → 1.

---

### Finding 02 — audit_log target_id index missing despite being claimed fixed

**File:** `src/backend/db/schema/audit-log.schema.js:16-19` (only two indexes declared) + all three migration files (no additional index on `target_id`)
**Severity:** HIGH

**Root cause.** SESSION_REPORT_FULL.md Phase 3 Round 3 lists "audit_log target_id index" as an applied fix. Neither the Drizzle schema nor the migration files contain such an index.

**Proof:**
```js
// audit-log.schema.js:16-19 — only two indexes
(table) => [
  index('audit_log_timestamp_idx').on(table.timestamp),
  index('audit_log_actor_idx').on(table.actorId),
]
```
```sql
-- drizzle/0001_sudden_scalphunter.sql:41-42 — only two audit_log indexes
CREATE INDEX "audit_log_timestamp_idx" ON "audit_log" USING btree ("timestamp");
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_id");
```

But the audit-log reader uses a target_id filter:
```js
// report-controller.js:245-250
const result = await db.execute(sql`
  SELECT * FROM audit_log
  WHERE target_id = ANY(${sessionIds})
  ORDER BY timestamp DESC
  LIMIT ${limit} OFFSET ${offset}
`);
```

**Complexity analysis.** Every `target_id = ANY(...)` filter does a full scan of audit_log (or relies on the `timestamp` index for sort and filters in-memory). `audit_log` grows unbounded across ALL scans on the platform (every scan attempt by every student writes a row via `audit-logger.js`). At 1,000 students × 20 scan attempts/week × 14 weeks = 280,000 rows/semester, cumulative across semesters. Full scan is O(N) where N is platform-wide, not course-scoped.

Worse: the COUNT query at line 252-255 also full-scans.

**Recommended fix.** Add actual migration:
```sql
CREATE INDEX audit_log_target_idx ON audit_log USING btree (target_id);
```
Update schema file to match. Update SESSION_REPORT_FULL.md to reflect real state.

---

### Finding 03 — getAuditLog unbounded sessionIds expansion

**File:** `src/backend/controllers/report-controller.js:239-255`
**Severity:** HIGH

**Root cause.** Before hitting audit_log, the handler fetches ALL session IDs for the course, then embeds them into `ANY(${sessionIds})`. No LIMIT on the session fetch, no bound on array size.

**Proof:**
```js
// report-controller.js:239-241
const courseSessions = await db.select({ sessionId: sessions.sessionId }).from(sessions)
  .where(eq(sessions.courseId, id));
const sessionIds = courseSessions.map((s) => s.sessionId);
```

**Complexity analysis.** m = sessions per course. For a 1-year course (exceptional but possible under ad-hoc session pattern) m could exceed 100. PostgreSQL query planner usually chooses seqscan when `ANY(array)` cardinality exceeds a threshold. Pagination doesn't help because both the page query AND the count query use the full array.

Additionally: querying sessions by `course_id` is indexed (`sessions_course_idx`) so this step is fine — but the _result_ is unbounded.

**Recommended fix.** Add `JOIN` style instead of IN-list:
```sql
SELECT a.* FROM audit_log a
INNER JOIN sessions s ON s.session_id = a.target_id
WHERE s.course_id = $1
ORDER BY a.timestamp DESC
LIMIT ... OFFSET ...
```
Combined with Finding 02's `target_id` index and the existing `sessions_course_idx`, the planner can do a nested-loop index join.

---

### Finding 04 — calculateAllAttendancePcts CROSS JOIN blowup

**File:** `src/backend/services/attendance-calculator.js:46-76`
**Severity:** MEDIUM

**Root cause.** The CTE explicitly `CROSS JOIN`s `enrollments` with `sessions`, producing n×m rows before the LEFT JOIN to attendance. This is intentional (it's how you materialize the "every student × every session" matrix for COALESCE-to-absent semantics), but it scales multiplicatively.

**Proof:**
```sql
-- attendance-calculator.js:48-61
WITH student_session_statuses AS (
  SELECT e.student_id, COALESCE(a.status, 'absent') AS effective_status
  FROM enrollments e
  CROSS JOIN sessions s
  LEFT JOIN attendance a
    ON a.session_id = s.session_id AND a.student_id = e.student_id
  WHERE e.course_id = ${courseId}
    AND e.removed_at IS NULL
    AND s.course_id = ${courseId}
    AND s.status = 'closed'
)
SELECT student_id, ...
GROUP BY student_id
```

**Complexity analysis.** Query cost: O(n·m) rows materialized in the CTE; Postgres will typically stream rather than spool, but the hash aggregation still touches all n·m rows. At a 300-student large lecture × 45 closed sessions = 13,500 rows. Multiply by the `LEFT JOIN` probe into attendance (indexed on `(session_id, student_id)` — O(log) per probe). Total work: O(n·m log(n·m)) on the indexed attendance join.

Called by `getEnrolledStudentsWithPct` — every time an instructor opens the roster view.

**Recommended fix.** Avoid CROSS JOIN and compute in two passes:
1. `SELECT student_id, COUNT(*) FROM enrollments WHERE course_id = $1 AND removed_at IS NULL GROUP BY student_id` gives n.
2. `SELECT student_id, COUNT(*) FILTER (WHERE status='present') AS p, COUNT(*) FILTER (WHERE status IN ('present','absent')) AS d FROM attendance INNER JOIN sessions USING(session_id) WHERE sessions.course_id = $1 AND sessions.status='closed' GROUP BY student_id`.
3. Compute absent_count = total_closed_sessions − (p + excused + d_attended) in app code.

This replaces O(n·m) row materialization with O(attendance_rows) which is typically O(n) for a well-attended course (~80% of n·m).

---

### Finding 05 — Scan live counter query is O(n) per scan

**File:** `src/backend/controllers/scan-controller.js:67-80`
**Severity:** MEDIUM

**Root cause.** After every successful scan, the handler runs a 3-way JOIN to compute `{present, total}` for the live counter broadcast. This query scans all enrollments for the session's course and all attendance rows for that session.

**Proof:**
```js
// scan-controller.js:67-75
const countResult = await db.execute(sql`
  SELECT
    COUNT(*) FILTER (WHERE a.status = 'present') AS present,
    COUNT(DISTINCT e.student_id) AS total
  FROM enrollments e
  LEFT JOIN attendance a ON a.session_id = ${result.sessionId} AND a.student_id = e.student_id
  INNER JOIN sessions s ON s.course_id = e.course_id AND s.session_id = ${result.sessionId}
  WHERE e.removed_at IS NULL
`);
```

**Complexity analysis.** n = enrolled students in the course. The planner picks enrollment as driver → n rows scanned, each does an indexed probe into attendance (O(log)) and sessions (O(1) PK). Per scan: O(n log n).

Concurrency impact: during a live 300-student lecture, 300 scans arrive in a 1–5 minute window. Each triggers this counter query → 300 × O(300 log 300) row-reads ≈ 750K index probes per session. Postgres can handle this on a single Neon instance but it's pure waste — the counter only needs `+1` on success.

**Recommended fix.** Replace the aggregation query with two cheap lookups:
- Cache `total` (enrolled count) per session in memory on session `start` — it doesn't change except via enroll/remove (rare during a scan window).
- Increment `present` counter in a Map keyed by sessionId on each successful scan.
- Re-sync from DB only on socket join (for late-joining dashboards).

This drops per-scan work from O(n log n) to O(1).

---

### Finding 06 — checkThresholdAndNotify recomputes full attendance % on every scan

**File:** `src/backend/services/notification-service.js:20-21` → `attendance-calculator.js:13-37`
**Severity:** MEDIUM

**Root cause.** `handleScan` and `overrideAttendance` both call `checkThresholdAndNotify(courseId, studentId)`, which calls `calculateAttendancePct` — which runs the full CTE over all closed sessions of that student in that course. Even though exactly one attendance row changed.

**Proof:**
```js
// notification-service.js:20-21
export async function checkThresholdAndNotify(courseId, studentId) {
  const pct = await calculateAttendancePct(courseId, studentId);
```

**Complexity analysis.** m = closed sessions in course. Per scan: O(m) rows scanned in the CTE. SESSION_REPORT_FULL mentions notification threshold "fires after every scan AND every override — is it bounded?" — the _notification email_ is bounded by one-per-crossing, but the _computation itself_ is not.

At 300 scans into a 45-session course: 300 × 45 = 13,500 session-status computations just for threshold checks per class session.

**Recommended fix.** Pre-compute the threshold crossing in SQL:
```sql
SELECT
  COUNT(*) FILTER (WHERE COALESCE(a.status,'absent')='present') * 100.0
    / NULLIF(COUNT(*) FILTER (WHERE COALESCE(a.status,'absent') IN ('present','absent')),0) < $threshold AS below
FROM sessions s LEFT JOIN attendance a ON ...
WHERE s.course_id = $1 AND s.status='closed'
```
Return a boolean, skip the 2 downstream round-trips if above. Or: maintain `attendance_summary` table (student_id, course_id, present_count, absent_count, excused_count, updated_at) incrementally updated via triggers or in the scan handler. Threshold check becomes O(1).

---

### Finding 07 — getCourse returns all sessions with no LIMIT

**File:** `src/backend/controllers/course-controller.js:213-218`
**Severity:** MEDIUM

**Root cause.** Course detail endpoint fetches the entire session list.

**Proof:**
```js
// course-controller.js:214-218
const courseSessions = await db
  .select()
  .from(sessions)
  .where(eq(sessions.courseId, id))
  .orderBy(sessions.scheduledStart);
```

**Complexity analysis.** m = all sessions ever (scheduled, closed, cancelled, active). At semester end plus 10–20 ad-hoc sessions, m≈60. The response carries full session objects (scheduledStart/End, actualStart/End, status, etc.). The `instructor/course.html` renders this entire list into the DOM — with no virtualization.

**Recommended fix.** Add pagination (`?limit=50&offset=0`) or status filter (`?status=upcoming|past|all`). Default to upcoming + last 10 past sessions.

---

### Finding 08 — listCourses unbounded for instructor

**File:** `src/backend/controllers/course-controller.js:152-158`
**Severity:** MEDIUM

**Root cause.** Instructor's course list has no LIMIT and no semester filter — it returns every course they've ever created.

**Proof:**
```js
// course-controller.js:153-158
if (req.session.role === 'instructor') {
  const result = await db
    .select()
    .from(courses)
    .where(eq(courses.instructorId, req.session.userId));
  return res.json({ courses: result });
}
```

**Complexity analysis.** k_total = instructor's lifetime course count. At 4 courses/semester × 20 years = 160 courses, each with full JSONB `weekly_schedule` and geofence_center. Response could exceed 50KB.

**Recommended fix.** Add `?semester=current|all` filter, default to current semester (join on `courses.semester` or `semesterStart > now() - 6 months`).

---

### Finding 09 — session-generator unbounded by user input

**File:** `src/backend/services/session-generator.js:28-68`
**Severity:** MEDIUM

**Root cause.** The session generator loops over `weeklySchedule.length × num_weeks` and produces an array of session rows. Neither dimension is bounded server-side:
- `createCourseSchema` validates each slot but not the array length cap (`z.array(...).min(1)` — no `.max()`).
- `semesterStart` and `semesterEnd` are validated as dates but not as a bounded range.

**Proof:**
```js
// course-controller.js:24-30 — no max
weeklySchedule: z.array(
  z.object({ day: z.enum([...]), start: z.string().regex(...), end: z.string().regex(...) }),
).min(1),
```
```js
// session-generator.js:34-62 — two nested loops with no cap
for (const slot of weeklySchedule) { ... while (!isAfter(current, end)) { ... } }
```

**Complexity analysis.** O(slots × weeks). A malicious instructor (or test typo) could submit a 7-day-schedule with a 5-year semester → 7 × 260 = 1,820 session rows, then `db.insert(sessions).values(sessionRows)` sends a single parametrized INSERT with 1,820 tuples. Postgres `pg` driver has a default param limit of 65,535 → breaks at ~9K sessions but memory pressure before that.

Also note: `course-controller.js:141-143` does an unbatched `db.insert(sessions).values(sessionRows)` — one big transaction. If it fails near the end, the whole insert rolls back but the `courses` row from line 113-131 was already committed → leaves an orphan course with 0 sessions. Not strictly a complexity issue but adjacent.

**Recommended fix.** Zod: `.max(7)` on `weeklySchedule`, `.refine()` that `semesterEnd - semesterStart ≤ 180 days`. In code: cap generated output at `MAX_SESSIONS_PER_COURSE = 200` and return a 400 if exceeded.

---

### Finding 10 — getPerSessionReport + exportCsv: O(n·m) in JS memory

**File:** `src/backend/controllers/report-controller.js:49-71` and `136-192`
**Severity:** MEDIUM

**Root cause.** The bulk `inArray()` fetch (the prior audit fix) eliminated N+1 DB round-trips, but the response construction still builds n × m row objects in JS memory:

**Proof (per-session report):**
```js
// report-controller.js:49-71
const report = [];
for (const sess of closedSessions) {              // m iterations
  const attendanceMap = ...
  const studentStatuses = enrolled.map((enrolledStudent) => { ... }); // n iterations
  report.push({ session: sess, students: studentStatuses, ... });
}
```

**Complexity analysis.** Response array has `m` entries, each with `n` student sub-entries. At 300 × 45 = 13,500 JSON objects serialized per request. Response size easily exceeds 2MB. The instructor dashboard downloads this for every "attendance" tab load.

**Recommended fix.** Server-side pagination (by session) or move to a streaming JSON response. For `exportCsv` specifically: stream CSV rows via `res.write()` + `csv-stringify` in stream mode rather than buffering the full `rows` array.

---

### Finding 11 — qr_tokens cleanup full scan (no expires_at index)

**File:** `src/backend/services/qr-service.js:107-113` + schema `qr-token.schema.js:15`
**Severity:** LOW

**Root cause.** The cleanup query filters by `expires_at < now() - INTERVAL '1 hour'` but the only index on `qr_tokens` is `(session_id, generated_at)`.

**Proof:**
```js
// qr-service.js:109
await db.execute(sql`DELETE FROM qr_tokens WHERE expires_at < now() - INTERVAL '1 hour'`);
```
```js
// qr-token.schema.js:15
(table) => [index('qr_tokens_session_idx').on(table.sessionId, table.generatedAt)],
```

**Complexity analysis.** Full scan every 10 min. At 50 concurrent active sessions × 144 tokens/hour (at 25s refresh) × 1h retention ≈ 7,200 rows max table size. Full scan is trivial at this scale but grows linearly with peak concurrency.

**Recommended fix.** Add `index('qr_tokens_expires_idx').on(table.expiresAt)`. Or a partial index `WHERE expires_at < now()` if Drizzle supports it.

---

### Finding 12 — Geofence stored as TEXT, not geography type

**File:** `src/backend/validators/geofence-checker.js:16-34` + `courses.geofence_center` column type in `0000_outstanding_psynapse.sql:9`
**Severity:** LOW

**Root cause.** `geofence_center` is `text` containing WKT (`SRID=4326;POINT(lng lat)`). Every scan does `ST_GeogFromText(geofence_center)` at query time — a per-row string parse. A proper `geography(Point, 4326)` column stores the binary representation once and enables a GiST index.

**Complexity analysis.** The scan query filters `WHERE course_id = $1` (PK lookup → 1 row), so only ONE cast per scan. Impact is minimal today — but if any future endpoint ever does "find all courses within X of location Y" (e.g. "what classrooms is this student near?"), the text column will force a seq scan with per-row cast.

**Recommended fix.** Migrate column type to `geography(Point, 4326)`. Add GiST index. Saves ~microseconds per scan today; prevents O(N) full scan on future proximity queries.

---

### Finding 13 — enrollments lacks student_id index

**File:** `drizzle/0000_outstanding_psynapse.sql:29-35`
**Severity:** LOW

**Root cause.** `enrollments` has composite PK `(course_id, student_id)`. Btree PK can serve `WHERE course_id = ?` (prefix) and `WHERE course_id = ? AND student_id = ?` (full). It cannot efficiently serve `WHERE student_id = ?` alone, which is how `listCourses` queries for students.

**Proof:**
```js
// course-controller.js:171-178
.from(enrollments)
.innerJoin(courses, ...)
.where(and(eq(enrollments.studentId, req.session.userId), isNull(enrollments.removedAt)))
```

**Complexity analysis.** Total enrollment rows across the platform. At 5K students × 5 courses = 25K rows, seq scan is ~few ms. Acceptable today; degrades linearly as the platform grows.

**Recommended fix.** `CREATE INDEX enrollments_student_idx ON enrollments (student_id) WHERE removed_at IS NULL;`

---

### Finding 14 — generateEnrollmentCode no jitter on retry

**File:** `src/backend/services/enrollment-code.js:14-34`
**Severity:** LOW

Acceptable as-is. 32^6 ≈ 1B collision space; ENROLLMENT_CODE_MAX_RETRIES handles the birthday-paradox case. Noted for completeness.

---

### Finding 15 — socket-service join-session re-queries per join

**File:** `src/backend/services/socket-service.js:66-76`
**Severity:** LOW

Every `join-session` emit triggers `canAccessSession`, which runs 2 sequential DB queries (session lookup + course-or-enrollment lookup). No per-socket cache of "sessions this socket already verified". A socket that reconnects and re-joins a room pays the cost again. Also: no rate limit on `join-session` emits.

**Recommended fix.** Cache per-socket set of authorized-session IDs. Optional: rate-limit `join-session` to N/min per socket.

---

## Conclusion

### Overall Health: GOOD

The codebase is in substantially better complexity health than most at this stage. Prior audit rounds eliminated the textbook N+1 patterns in reports and CSV export, and the attendance calculator uses a proper SQL CTE rather than per-student queries. The 6-layer scan pipeline is genuinely O(1) per layer — no hidden loops.

### Top 3 Risks (order of real-world impact)

1. **Finding 02 — audit_log.target_id index missing.** The session report CLAIMS this fix is applied, but it is not. Every audit-log viewer load does an unbounded full scan of platform-wide audit data. This is also a documentation-vs-reality drift — fix both the code and the SESSION_REPORT_FULL.md claim.

2. **Finding 05 — Scan live counter O(n) per scan.** At a 300-student lecture hall with simultaneous scan-in, this generates ~90K row-reads per class session. Cheap today on Neon but degrades with concurrent sessions. The fix (in-memory counter increment) is simple and high-leverage.

3. **Finding 06 — Threshold check recomputes full attendance % on every scan.** Wasted O(m) work per scan when the delta is a known +1. Combined with Finding 05 in the scan hot path, a single scan triggers two O(m) and one O(n) queries — all of which could be O(1) with a small attendance_summary cache.

### Findings NOT Worth Fixing Yet

- Findings 11, 12, 13, 14, 15 (all LOW). Each is a correct observation but impact is negligible at current scale. Revisit if the platform grows past 5K users or starts hosting multi-year archived courses.

### Sanity Check Against SESSION_REPORT_FULL.md Claims

| Claim in Session Report | Actual State | Notes |
|---|---|---|
| N+1 queries in reports fixed via bulk inArray | True for `getPerSessionReport`, `exportCsv` | `getMyAttendance` still N+1 (Finding 01) |
| CSV export N+1 fixed | True at DB layer | But O(n·m) memory still (Finding 10) |
| attendance-calculator uses CTE with COALESCE | True | But CROSS JOIN is O(n·m) (Finding 04) |
| notification threshold uses one-per-crossing | True (email dedup correct) | But computation still O(m) per scan (Finding 06) |
| QR token periodic cleanup every 10 min | True | Full scan (Finding 11) |
| audit_log target_id index | **False — not present** | (Finding 02) |
