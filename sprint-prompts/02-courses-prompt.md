# Sprint 2 — Course Management

## When to use this prompt

After Inc 1 is ✅ complete in `docs/STATE.md`. Auth must be working before instructors can create courses or students can enroll.

## Pre-flight checklist

- [ ] Inc 1 marked ✅ in `docs/STATE.md`
- [ ] You can register an instructor and a student account, log in, and reach the dashboards
- [ ] DB has the `users`, `students`, `instructors`, `email_verification_tokens` tables
- [ ] `/clear` the previous Claude Code session (Inc 2 is fresh context)

## The prompt

```
Start Increment 2 — Course Management.

Read these documents in order:
- @docs/AGENTS.md
- @docs/GLOSSARY.md
- @docs/STATE.md
- @docs/SCHEMA.md
- @docs/INCREMENTS.md
- @docs/CODEBASE_MAP.md
- @docs/FRS.docx (focus on FR2.1 through FR2.8)
- @docs/uml/04-class-diagram.svg (Course, Geofence, enrollments)
- @docs/uml/06-session-state-machine.svg (session lifecycle states)
- @increments/01-auth/PLAN.md (so you understand the auth + role middleware that's already in place)

Context:
Inc 1 is complete: users can register, verify, log in, reach role-based dashboards. Now build the course management layer:
- Instructor creates courses with weekly schedule
- Auto-generated 6-char enrollment code (alphanumeric, exclude confusing chars: 0/O, 1/I/l)
- Students self-enroll via code
- Geofence config with map preview (lat, lng, radius)
- Per-course config: attendance window, warning threshold, QR refresh interval
- Auto-generation of sessions from weekly schedule for the semester
- Instructor can cancel auto-sessions or add ad-hoc ones
- Instructor can remove a student (soft-delete via removed_at, historical records retained)

Per @docs/AGENTS.md Rule 1, do not write code yet. Produce a plan in @increments/02-courses/PLAN.md following the PLAN.md template in @docs/PROMPT_TEMPLATES.md.

The plan must explicitly address:
1. Drizzle schema additions: courses, enrollments, sessions tables (per @docs/SCHEMA.md)
2. PostGIS integration — using `geography(Point, 4326)` for geofence_center; example INSERT and SELECT queries
3. Map preview — which library? Leaflet with OpenStreetMap tiles is free and zero-config. Avoid Google Maps (requires API key and billing).
4. Enrollment code generation — algorithm to generate uniques and retry on collision (cryptographically random, not Math.random)
5. Auto-session generation logic — given a weekly schedule (`[{day: 'mon', start: '09:00', end: '10:15'}, ...]`) and a semester date range, produce all session rows. Handle DST and timezone (Asia/Kuwait, UTC+3, no DST).
6. Frontend pages: instructor course list, course create/edit form (with map for geofence), enrollment code display, student enrollment form, instructor enrolled student list with attendance % column
7. The 10 acceptance criteria from @docs/INCREMENTS.md § Increment 2, mapped to tests

Open questions you should flag in the plan rather than guessing:
- For sessions auto-generated from the weekly schedule, what's the date range? FRS doesn't specify. Suggest: from course creation date through end of semester, with semester boundaries entered as part of course creation.
- When an instructor removes a student from a course (FR2.5), should the student see the course disappear from their dashboard, or should it stay visible as "removed by instructor"? FRS just says "historical records retained" but doesn't specify visibility.
- Should the enrollment code be regeneratable by the instructor (e.g., if leaked), or fixed for the semester? FRS doesn't specify.

Wait for plan approval. Guard phrase: "address all notes, don't implement yet"
```

## What to expect

Claude Code produces `increments/02-courses/PLAN.md`. Review for:

- **Schema additions** — courses table has the geography column, the right indexes, the right defaults
- **Map preview decision** — Leaflet is the right call; flag if Claude Code suggests something requiring an API key
- **Enrollment code algorithm** — cryptographically random, not `Math.random()`
- **Auto-session generation** — handles timezone correctly (Asia/Kuwait), respects course creation date, doesn't generate sessions in the past
- **Open questions** — are the three I flagged answered?

## Estimated time

- Plan: 2-3 minutes
- Iteration: 5-15 minutes
- Implementation: 25-45 minutes (more frontend than Inc 1)
- Review: 10 minutes

**Total: ~45-75 minutes** for Inc 2.
