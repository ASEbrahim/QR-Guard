# Sprint 5 — Notifications, Override, Audit, Hardening

## When to use this prompt

After Inc 4 is ✅ — % calculation must work before threshold detection can fire warning emails. This is the final increment.

## Pre-flight checklist

- [ ] Inc 4 ✅ in `docs/STATE.md`
- [ ] You can: see attendance %s on the instructor dashboard and student dashboard, export CSV
- [ ] Email service from Inc 1 is functional (Resend in prod, console.log mock in dev)
- [ ] `/clear` the previous Claude Code session

## The prompt

```
Start Increment 5 — Notifications, Override, Audit, Hardening.

Read these documents in order:
- @docs/AGENTS.md
- @docs/GLOSSARY.md
- @docs/STATE.md
- @docs/SCHEMA.md (warning_email_log table is critical for the "one email per crossing" logic)
- @docs/INCREMENTS.md
- @docs/CODEBASE_MAP.md
- @docs/FRS.docx (focus on FR6.1 through FR6.4 and FR7.1 through FR7.3)
- @docs/uml/04-class-diagram.svg (AuditLog, Override-related methods on Instructor)
- @increments/01-auth/PLAN.md, @increments/03-scan-pipeline/PLAN.md, @increments/04-reports/PLAN.md (full context of what exists)

Context:
This is the final increment. It implements:
- Warning emails (one per threshold crossing, NOT one per absence)
- Instructor notification at AUK 15% absence limit
- Manual attendance override with reason + audit log
- Excused absence support
- Hardening pass: rate limiting, security headers, audit-log-append-only enforcement, manual pen-test smoke

The "one email per crossing" semantics are critical and easy to get wrong. Use the warning_email_log table from @docs/SCHEMA.md:
- A warning fires only when there is no row with `recovered_above_at IS NULL` for this (course, student)
- When the student crosses below: insert row with crossed_below_at = now()
- When the student recovers above threshold: update most recent row, set recovered_above_at = now()
- When they cross below again: insert NEW row (new crossing, new email)

Per @docs/AGENTS.md Rule 1, do not write code yet. Produce a plan in @increments/05-notifications/PLAN.md following the PLAN.md template in @docs/PROMPT_TEMPLATES.md.

The plan must explicitly address:

**Notifications (FR6):**
1. Where the threshold check fires — after every successful scan AND after every override (since both can change %)
2. The crossing logic above, with pseudocode showing the SELECT + INSERT/UPDATE flow
3. Email content templates (warning + AUK-limit notification + optional per-scan confirmation)
4. The AUK 15% limit notification — instructor receives one email when ANY student crosses 15% absences for the first time. Same crossing logic applies.
5. Email service abstraction reuse from Inc 1 — don't reinvent

**Override (FR7):**
6. `POST /api/sessions/:id/override` endpoint — body: `{studentId, status, reason}`, returns 200 with new audit log row
7. Override updates the attendance row AND inserts an audit_log row with old + new status + reason + actor (instructor) + target (student)
8. Excuse logic (FR7.3): status='excused' excludes from the % denominator (already baked into the SQL from SCHEMA.md, confirm)
9. Override authorization: only the course instructor can override their own course

**Audit (FR7.2):**
10. The DB trigger from @docs/SCHEMA.md (audit_log_no_update / audit_log_no_delete) — confirm it's in place; if not, add the migration
11. Audit log viewer for instructor — paginated list of audit entries for their courses (use existing reports infrastructure)
12. Confirm: every scan attempt, every override, every login (success/fail) is logged. Anything else logged? Suggest: course config changes (FR2.6 geofence updates) since those affect verification — flag as open question.

**Hardening:**
13. Rate limiting — `express-rate-limit` middleware
    - `/api/login`: 5 failures per 10 minutes per IP → 429
    - `/api/scan`: 60 requests per minute per IP → 429
    - `/api/auth/register`: 10 per hour per IP → 429
14. Security headers — `helmet` middleware (HSTS, X-Frame-Options DENY, X-Content-Type-Options nosniff, basic CSP)
15. CORS — explicit allowlist for your frontend origin only, credentials enabled
16. Input validation — confirm Zod (or similar) is validating every request body and rejecting unknown fields
17. SQL injection — confirm Drizzle's parameterized queries are used everywhere, no raw string interpolation
18. Manual penetration test smoke (write the script, run it):
    - Try to access `/api/courses/:id` for a course you don't own → expect 403
    - Try to scan with a forged JWT → expect 401
    - Try to UPDATE audit_log directly via SQL → expect DB rejection
    - Try to register with a non-AUK email → expect 400
    - Try to override an attendance for a student in someone else's course → expect 403
    - Try to read another student's attendance via `/api/me/attendance` with their ID in the URL → expect 403

Open questions you should flag in the plan rather than guessing:
- Should the AUK 15% notification go to the instructor only, the student only, or both? FR6.2 says "Instructor notified" — clear. But should the student also get an email at this point? Suggest: yes, the student is already getting warning emails before this point, so a final "you've exceeded the limit" email is consistent.
- Should the warning email include action items (e.g., "schedule office hours") or just the data? FR6.3 just lists what's in it. Suggest: data + a generic "contact your instructor" line, no specific scheduling.
- Are there any FR1-5 endpoints that DON'T need rate limiting? Suggest: no — apply a default global rate limit (200/min per IP) and override per-endpoint as above.
- Is there a need for an admin override that can edit the audit log? FR7.2 says "append-only" — suggest no, ever, for any role.

After the implementation, run the manual pen-test smoke and report results.

Wait for plan approval. Guard phrase: "address all notes, don't implement yet"
```

## What to expect

Claude Code produces `increments/05-notifications/PLAN.md`. Review for:

- **Crossing logic is correct** — the warning_email_log table is the source of truth; the logic uses SELECT + INSERT/UPDATE, not a counter
- **Threshold check fires in two places** — after scans AND after overrides
- **Override updates BOTH attendance AND audit_log** — atomically (transaction)
- **Audit log triggers exist** — the DB-level enforcement, not just app-level
- **Rate limits applied to the right endpoints** — login, scan, register at minimum
- **Helmet config is reasonable** — CSP isn't so strict it breaks the app
- **Pen-test results reported** — every smoke test passes

## Final review checklist

When Inc 5 is complete, the system is feature-complete. Before declaring done:

- [ ] All 5 increments ✅ in `docs/STATE.md`
- [ ] `npm run lint` clean across the whole codebase
- [ ] `npm test` passes (all unit + integration tests)
- [ ] Manual end-to-end smoke test:
  - Register as instructor, create a course with geofence, get enrollment code
  - Register as student, enroll, log in, see course
  - Instructor starts a session, QR appears
  - Student scans (you'll need to be in the geofence or mock GPS), success
  - Instructor sees real-time counter update
  - Instructor overrides another scan, sees audit log entry
  - Mock the student's % to drop below threshold, see warning email queued
  - Export CSV, check format
- [ ] All 9 UML diagrams in `docs/uml/` still match the implementation; no silent deviations
- [ ] `docs/STATE.md` updated with final status and "feature complete" date

## Estimated time

- Plan: 5-8 minutes (lots of moving pieces)
- Iteration: 10-20 minutes
- Implementation: 50-80 minutes
- Pen-test execution: 15 minutes
- Final review: 20-30 minutes

**Total: ~2-2.5 hours** for Inc 5.

## When this is done

The system is complete. You can now:
1. Write Progress Report 2 with real implementation status (instead of "0%")
2. Build the presentation slides from the report
3. Deploy to a hosting provider for the demo (or run locally for the demo)
4. If time allows, expand the FRS with the wrapper sections (Abstract, TOC, etc.) for the Final Report

Submit PR2 with confidence.
