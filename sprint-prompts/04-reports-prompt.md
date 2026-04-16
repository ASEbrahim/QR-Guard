# Sprint 4 — Reports & Analytics

## When to use this prompt

After Inc 3 is ✅ — you need attendance data to report on. Without scans recorded, there's nothing to query.

## Pre-flight checklist

- [ ] Inc 3 ✅ in `docs/STATE.md`
- [ ] You can: start a session, scan as a student, see the attendance row in DB
- [ ] At least 5-10 attendance records exist (run a few test scans for realistic test data)
- [ ] `/clear` the previous Claude Code session

## The prompt

```
Start Increment 4 — Reports & Analytics.

Read these documents in order:
- @docs/AGENTS.md
- @docs/GLOSSARY.md
- @docs/STATE.md
- @docs/SCHEMA.md (focus on the helper queries section — the % calculation SQL is there)
- @docs/INCREMENTS.md
- @docs/CODEBASE_MAP.md
- @docs/FRS.docx (focus on FR5.1 through FR5.7)
- @docs/uml/04-class-diagram.svg (Report class)
- @increments/03-scan-pipeline/PLAN.md (so you understand the attendance schema and Socket.IO setup)

Context:
Inc 3 is complete: scans are recording attendance, audit log is populated. Now build the reporting layer:
- Attendance % calculation per student per course (excused excluded from denominator)
- Per-session report: student list with status, timestamps, GPS coords
- Per-student report: all sessions with running %
- Student self-view on their dashboard
- CSV export with filters (date range, student, status)
- Real-time session dashboard reusing the Socket.IO connection from Inc 3
- "At-risk" flag (≤85%) on the instructor's roster

The % calculation SQL is already in @docs/SCHEMA.md § Helper queries. Use it as the canonical formula. Do NOT reinvent it client-side.

Per @docs/AGENTS.md Rule 1, do not write code yet. Produce a plan in @increments/04-reports/PLAN.md following the PLAN.md template in @docs/PROMPT_TEMPLATES.md.

The plan must explicitly address:

1. Backend endpoints:
   - `GET /api/courses/:id/attendance` — per-session report (instructor only)
   - `GET /api/courses/:id/attendance/student/:studentId` — per-student report (instructor or that student)
   - `GET /api/courses/:id/attendance.csv` — CSV export with query params for filters
   - `GET /api/me/attendance` — student self-view across all enrolled courses
2. Authorization checks: students can only see their own data, instructors can only see their own courses' data, return 403 otherwise
3. The % calculation: use the SQL from @docs/SCHEMA.md. Confirm: does the formula handle the "0 sessions held" case (returns NULL)? How does the API surface that — `null`? `"N/A"`? `0`? Pick one and document.
4. CSV generation: which library? Suggest `csv-stringify` (lightweight, streaming-capable). One row per attendance record.
5. CSV filter logic: how the query params (`from`, `to`, `studentId`, `status`) compose into a SQL WHERE clause without SQL injection (parameterized queries, not string concat)
6. Real-time dashboard: extend the Socket.IO setup from Inc 3 — when a scan succeeds, broadcast updated counters AND updated %s to all instructor clients connected to that session
7. Frontend pages:
   - Instructor reports page (per-session list, filterable, CSV download button)
   - Per-student detail page (drill-down from roster)
   - Updated student dashboard with attendance % cards per course
   - Real-time session dashboard (the live counter from Inc 3, extended with at-risk flags)
8. The 10 acceptance criteria from @docs/INCREMENTS.md § Increment 4, mapped to tests

Open questions you should flag in the plan rather than guessing:
- Should the CSV include the audit log data (rejected scans), or only successful attendance records? FR5.5 just says "filterable, by date range / student / status" — ambiguous on rejections. Suggest: only successful records by default, with an optional `?include_rejections=true` flag.
- For the at-risk flag (FR5.7), does ≤85% mean ≤ the warning threshold (which is course-configurable, default 85%) or hardcoded ≤85%? Suggest: course-configurable threshold.
- Real-time updates: when a scan happens, should the dashboard recompute every student's % or only the affected student's? Suggest: only the affected student (perf, and simpler).
- Should the per-session report show students who didn't scan as "absent" rows, or just omit them? Currently the attendance table only has rows for actual scan attempts. Suggest: LEFT JOIN to enrollments and treat missing rows as "absent" — generates absent rows on the fly without DB inserts.

Wait for plan approval. Guard phrase: "address all notes, don't implement yet"
```

## What to expect

Claude Code produces `increments/04-reports/PLAN.md`. Review for:

- **Authorization** — every endpoint has the right access control; students can't fish for other students' data
- **Parameterized queries** — no string concatenation in SQL (security)
- **% calculation matches SCHEMA.md formula** — should be the SQL helper, not reinvented
- **CSV filter logic** — handled with prepared statements, escapes properly
- **Real-time updates** — uses existing Socket.IO setup, not a new connection
- **"Absent" rows** — generated via LEFT JOIN, not inserted into DB

## Estimated time

- Plan: 3-5 minutes
- Iteration: 5-15 minutes
- Implementation: 30-50 minutes
- Review: 10-15 minutes

**Total: ~50-90 minutes** for Inc 4.
