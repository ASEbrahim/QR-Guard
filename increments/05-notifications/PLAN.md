# Sprint C — Reports + Notifications + Hardening

**Spec source:** INCREMENTS.md § Inc 4 + Inc 5
**FRS sections:** FR5.1–FR5.7, FR6.1–FR6.4, FR7.1–FR7.3
**Dependencies:** Sprint A (auth, courses), Sprint B (attendance data, audit log, Socket.IO)

---

## Scope confirmation

This sprint adds the read layer on top of what Sprint A and B built. Reports query the attendance and enrollment tables. Notifications trigger off the % calculation. Override mutates attendance rows and logs to audit. Hardening wraps the whole app in rate limiting and security headers. No new architectural patterns — it's queries, email sends, and middleware.

---

## Out of scope

- PDF export (text + CSV only)
- Cross-course aggregate analytics
- Charts / graphs (tables only)
- SMS / push notifications
- Customizable email templates

---

## Data model changes

### New table: warning_email_log

| Column | Type | Constraints |
|---|---|---|
| course_id | uuid | FK courses(course_id) ON DELETE CASCADE |
| student_id | uuid | FK students(user_id) ON DELETE CASCADE |
| crossed_below_at | timestamptz | NOT NULL |
| recovered_above_at | timestamptz | NULL |

PK: (course_id, student_id, crossed_below_at)

One-per-crossing semantics:
- Warning fires only when no row exists with `recovered_above_at IS NULL` for this (course, student)
- Student crosses below threshold → INSERT with `crossed_below_at = now()`
- Student recovers above → UPDATE most recent row, set `recovered_above_at = now()`
- Student crosses below again → INSERT new row (new crossing, new email)

---

## Architecture decisions

### % calculation — canonical SQL from SCHEMA.md

```sql
SELECT
  COUNT(*) FILTER (WHERE a.status = 'present') * 100.0
  / NULLIF(COUNT(*) FILTER (WHERE a.status IN ('present', 'absent')), 0)
  AS attendance_pct
FROM sessions s
LEFT JOIN attendance a
  ON a.session_id = s.session_id AND a.student_id = $studentId
WHERE s.course_id = $courseId AND s.status = 'closed';
```

Excused sessions: `status = 'excused'` excluded from both numerator and denominator (the `IN ('present', 'absent')` filter handles this automatically). 0 closed sessions → `NULLIF` returns NULL → API surfaces as `null`.

This SQL is the single source of truth. Used by: per-student reports, student dashboard, at-risk flag, threshold check for notifications. Extracted into a shared helper `calculateAttendancePct(courseId, studentId)`.

### Absent rows generated on the fly

The attendance table only has rows for students who scanned (status='present') or were overridden. "Absent" students are those enrolled but with no attendance row for a closed session. Reports use LEFT JOIN from enrollments to generate absent rows without inserting them into the DB.

### Threshold check fires in two places

1. After every successful scan (in scan-controller.js, after recording attendance)
2. After every override (in the new override handler)

Both call the same `checkThresholdAndNotify(courseId, studentId)` function.

### Rate limiting strategy

| Endpoint | Limit | Window |
|---|---|---|
| `POST /api/auth/login` | 5 requests | 10 minutes per IP |
| `POST /api/auth/register` | 10 requests | 1 hour per IP |
| `POST /api/scan` | 60 requests | 1 minute per IP |
| All other routes | 200 requests | 1 minute per IP |

Uses `express-rate-limit`. Store: in-memory (fine for class project; production would use Redis).

---

## API surface

### Reports — `src/backend/routes/report-routes.js`

| Method | Path | Auth | Success | Errors |
|---|---|---|---|---|
| GET | `/api/courses/:id/attendance` | instructor (course owner) | 200 `{sessions: [{session, students: [{name, status, recordedAt, gps}]}]}` | 401, 403, 404 |
| GET | `/api/courses/:id/attendance/student/:studentId` | instructor OR that student | 200 `{student, sessions: [{date, status, recordedAt}], attendancePct}` | 401, 403, 404 |
| GET | `/api/courses/:id/attendance.csv` | instructor | 200 CSV download | 401, 403, 404 |
| GET | `/api/me/attendance` | student | 200 `{courses: [{course, attendancePct}]}` | 401 |

CSV filters via query params: `?from=2026-01-01&to=2026-06-01&studentId=uuid&status=present`

### Override — added to `src/backend/routes/session-routes.js`

| Method | Path | Auth | Body | Success | Errors |
|---|---|---|---|---|---|
| POST | `/api/sessions/:id/override` | instructor (course owner) | `{studentId, status, reason}` | 200 `{attendance, auditEntry}` | 400, 401, 403, 404 |

### Audit viewer — added to `src/backend/routes/report-routes.js`

| Method | Path | Auth | Success |
|---|---|---|---|
| GET | `/api/courses/:id/audit-log` | instructor | 200 `{entries: [...], total, page}` |

Paginated: `?page=1&limit=50`

---

## File-level plan

### New dependencies
```
csv-stringify       — CSV generation (streaming)
express-rate-limit  — rate limiting middleware
```

### Backend — new files
```
src/backend/db/schema/warning-email-log.schema.js  (new) Drizzle schema
src/backend/db/schema/index.js                      (modify) re-export

src/backend/services/attendance-calculator.js       (new) shared % calculation + threshold check
src/backend/services/notification-service.js        (new) warning email logic, one-per-crossing

src/backend/controllers/report-controller.js        (new) per-session, per-student, CSV, self-view, audit-log
src/backend/controllers/override-controller.js      (new) override status + audit log entry
src/backend/routes/report-routes.js                 (new) /api/courses/:id/attendance, /api/me/attendance

src/backend/middleware/rate-limiter.js               (new) express-rate-limit configs

src/backend/controllers/scan-controller.js          (modify) add threshold check after recording
src/backend/routes/session-routes.js                (modify) add override route
src/backend/server.js                               (modify) mount report routes, add rate limiter + helmet hardening
```

### Frontend — modifications
```
src/frontend/student/dashboard.html                 (modify) show real attendance % per course
src/frontend/instructor/course.html                 (modify) add reports tab, at-risk flags, override UI, audit log viewer, CSV download
```

### Tests
```
src/backend/services/attendance-calculator.test.js  (new) % calc: 0 sessions, mixed, excused excluded
src/backend/services/notification-service.test.js   (new) one-per-crossing: below, recover, below again
src/backend/controllers/override-controller.test.js (new) override creates audit entry, excused excluded from %
tests/integration/report-flow.test.js               (new) per-session, per-student, CSV, self-view auth check
```

### Migration
```
drizzle/0002_sprint_c.sql                           (new) warning_email_log table
```

### Doc updates
```
docs/STATE.md                                       (modify) mark Sprint C + all increments complete
docs/CODEBASE_MAP.md                                (modify) add all new files
docs/SCHEMA.md                                      (modify) add warning_email_log
```

---

## Test plan

### Inc 4 acceptance criteria (Reports)

| # | Criterion | Test |
|---|---|---|
| 1 | Per-session report: correct count + status | integration: create session with mixed attendance → verify counts |
| 2 | Per-student report: same data filtered | integration: same data, filter by student → matches |
| 3 | % calculation: 0 sessions (N/A), 1, many | unit: attendance-calculator with edge cases |
| 4 | Excused excluded from % denominator | unit: 5 sessions, 1 excused → denominator is 4 |
| 5 | Student self-view: own history + % | integration: GET /api/me/attendance → own courses only |
| 6 | Student can't see another student's data | integration: GET with wrong studentId → 403 |
| 7 | CSV exports with correct headers | integration: GET .csv → parse, check headers + row count |
| 8 | CSV filters: date range, student, status | integration: filter by status=present → only present rows |
| 9 | Real-time dashboard updates | covered by Sprint B Socket.IO (already broadcasting) |
| 10 | At-risk flag at ≤ warning threshold | integration: student at 80% in course with 85% threshold → flagged |

### Inc 5 acceptance criteria (Notifications + Hardening)

| # | Criterion | Test |
|---|---|---|
| 1 | Warning email when % drops below threshold | unit: notification-service fires email |
| 2 | No duplicate emails per crossing | unit: two absences below → only one email |
| 3 | Recover + drop again → new email | unit: crossing sequence verified |
| 4 | Email content: name, course, %, count, threshold | unit: check email arguments |
| 5 | Instructor notified at AUK 15% limit | unit: 15% crossing → instructor email |
| 6 | Override changes status with required reason | integration: POST override → attendance row updated |
| 7 | Override creates audit log entry | integration: override → audit_log row with old+new status |
| 8 | Audit log append-only | integration: try UPDATE audit_log → DB error |
| 9 | Excused excluded from % (re-verified) | unit: already tested in #4 above |
| 10 | Rate limit on /api/login (5/10min) | integration: 6 requests → 429 on 6th |
| 11 | Security headers set | integration: check response headers for HSTS, X-Frame-Options |
| 12 | Pen-test: can't bypass auth, escalate role, read others' data | integration: suite of negative tests |

---

## Checkpoint commit strategy

1. **Commit 1:** `chore(sprint-c): add report/notification dependencies + DB migration`
2. **Commit 2:** `feat(sprint-c): reports + notifications + override + hardening`
3. **Fresh DB migration test:** drop, recreate, run all 3 migrations in order, verify all tables + triggers.

---

## Acceptance criteria check

### Inc 4
- [ ] AC 1: Per-session report correct
- [ ] AC 2: Per-student report correct
- [ ] AC 3: % handles 0/1/many sessions
- [ ] AC 4: Excused excluded from denominator
- [ ] AC 5: Student self-view works
- [ ] AC 6: Student can't see other students → 403
- [ ] AC 7: CSV with correct headers
- [ ] AC 8: CSV filters work
- [ ] AC 9: Real-time dashboard updates (Sprint B coverage)
- [ ] AC 10: At-risk flag visible

### Inc 5
- [ ] AC 1: Warning email fires on threshold crossing
- [ ] AC 2: No duplicate emails
- [ ] AC 3: Recover + re-cross → new email
- [ ] AC 4: Email content correct
- [ ] AC 5: Instructor notified at AUK 15%
- [ ] AC 6: Override with reason
- [ ] AC 7: Override audit log entry
- [ ] AC 8: Audit log is append-only
- [ ] AC 9: Excused excluded (re-verified)
- [ ] AC 10: Rate limiting works
- [ ] AC 11: Security headers present
- [ ] AC 12: Pen-test negative cases pass
