# Sprint 3 — Dynamic QR & Scan Pipeline

## When to use this prompt

After Inc 1 and Inc 2 are both ✅ in `docs/STATE.md`. **This is the critical-path increment** — the entire system's value depends on this working correctly. Test thoroughly.

## Pre-flight checklist

- [ ] Inc 1 and Inc 2 both ✅ in `docs/STATE.md`
- [ ] You can: register an instructor, create a course with a geofence, register a student, enroll, see them on the instructor's roster
- [ ] DB has all tables through `sessions` (you'll add `qr_tokens`, `attendance`, `audit_log` here)
- [ ] You've decided on a Socket.IO version (recommend latest stable, currently v4)
- [ ] `/clear` the previous Claude Code session

## A note on splitting this increment

Inc 3 is the largest. Consider splitting into two sprints:

**Sprint 3a:** Backend pipeline (DB schema, validators, routes, Socket.IO server, tests with mocked clients)
**Sprint 3b:** Frontend (instructor QR display, student scan UI, real device testing)

If you split, run Sprint 3a's prompt first, get it ✅, then run Sprint 3b. The split is mentioned in the prompt below — Claude Code will handle it cleanly if you ask.

## The prompt

```
Start Increment 3 — Dynamic QR & Scan Pipeline.

This is the critical-path increment. The entire QR-Guard value proposition lives here. Treat it accordingly.

Read these documents in order:
- @docs/AGENTS.md (re-read; this increment must follow Rule 4 strictly — every validator gets unit tests)
- @docs/GLOSSARY.md (especially the "Validator names" section — these names are canonical)
- @docs/STATE.md
- @docs/SCHEMA.md (qr_tokens, attendance, audit_log tables)
- @docs/INCREMENTS.md
- @docs/CODEBASE_MAP.md
- @docs/FRS.docx (focus on FR3.1 through FR3.6 and FR4.1 through FR4.10)
- @docs/uml/02-sequence-scan.svg (THIS IS AUTHORITATIVE for pipeline order)
- @docs/uml/03-activity-verification.svg (decision flow with the failure paths)
- @docs/uml/05-qr-state-machine.svg (QR token lifecycle)
- @docs/uml/06-session-state-machine.svg (session lifecycle)
- @docs/uml/04-class-diagram.svg (Session, QRToken, Attendance, AuditLog)
- @increments/01-auth/PLAN.md and @increments/02-courses/PLAN.md (so you know what already exists)

Context:
This is the most complex increment. It implements:
- Dynamic QR generation pushed via Socket.IO every 25 seconds
- HTTP polling fallback if WebSocket disconnects
- 6-layer scan verification pipeline (cheapest checks first, fail-fast)
- Audit log for every attempt (success or failure)
- Live counter on instructor view
- Offline queue on the student side

The pipeline order is NOT negotiable. Per @docs/uml/02-sequence-scan.svg:
1. QrValidator — token valid for current refresh cycle?
2. DeviceChecker — fingerprint matches stored binding?
3. IpValidator — country = Kuwait, no VPN/proxy?
4. GpsAccuracyChecker — accuracy ≤ 150m and ≠ 0?
5. GeofenceChecker — PostGIS ST_DWithin(radius + 15m margin)?
6. AuditLogger — append the attempt regardless of result

The orchestrator is `ScanVerifier` and it short-circuits on first failure. AuditLogger always runs (in a `finally` block).

Per @docs/AGENTS.md Rule 1, do not write code yet. Produce a plan in @increments/03-scan-pipeline/PLAN.md following the PLAN.md template in @docs/PROMPT_TEMPLATES.md.

The plan must explicitly address:

**Backend:**
1. Drizzle schema for qr_tokens, attendance, audit_log tables (per @docs/SCHEMA.md)
2. The append-only trigger on audit_log (DB-level enforcement)
3. Each of the 6 validators as separate classes/files (one per file per AGENTS.md Rule 3)
4. ScanVerifier orchestrator that runs them in order, short-circuits on failure, always logs to audit log
5. Socket.IO server setup, namespace strategy (one per session?), authentication of socket connections
6. QR token generation — payload format (Base64-encoded `{sessionId, generatedAt, geofence: {lat, lng, radius}}`), single-use enforcement (mark used in DB on successful scan), refresh interval driven by course config
7. Session start/stop endpoints — how the QR generation loop is started, how it's stopped (timer + manual)
8. Live counter — how the instructor's connected clients receive updates (Socket.IO broadcast on each successful scan)
9. ip-api.com integration with rate limit awareness (45/min) and graceful degradation (if API is down, what's the policy? FAIL-OPEN or FAIL-CLOSED?) — flag this as an open question

**Frontend:**
10. Instructor QR display page: full-screen QR, refreshes via Socket.IO, live counter, stop button
11. Student scan page: tap "Scan" → camera activates → decodes QR → POSTs to backend → shows result
12. Camera library choice — recommend `html5-qrcode` (MIT, well-maintained, simple API)
13. FingerprintJS visitor ID — captured at scan time, sent in request body
14. Offline queue — IndexedDB, retry on reconnect, expire after attendance window closes
15. Error handling UX — each failure type has a specific message (per FR4.8), with retry vs. give-up affordances

**Tests:**
16. Unit tests for every validator: happy path, failure path, boundary case
17. Integration test for the full pipeline: spin up test DB, mock ip-api.com, simulate scan → verify attendance + audit log rows
18. Pipeline order test: assert that a failure in QrValidator means DeviceChecker is never called (use spies)
19. Concurrency test: 60 concurrent simulated scans against the same session, all succeed, no duplicates

**Deferred (out of scope):**
- Bulk QR for hybrid in-person + remote (not in FR3 or FR4)
- Multi-device backup scanning
- Bluetooth proximity verification

Open questions you should flag in the plan rather than guessing:
- ip-api.com fail-open vs fail-closed: if the API times out or returns an error, should the scan proceed or fail? FRS doesn't specify. Suggest FAIL-OPEN (proceed) with the failure logged to audit log so the instructor sees it — rejecting students because of an external API problem feels wrong.
- Single-use enforcement: should "single-use per refresh cycle" be enforced at the QR token level (one student per token) or per (student, session, refresh window)? FR3.4 is ambiguous. Suggest the latter — same student can't scan twice in the same 25-sec window, but two different students can scan the same token.
- Offline queue retention: how long is a queued scan valid for? Suggest: until the attendance window for that session closes, then drop.
- Should the instructor be able to see which students were rejected and why (the audit log)? Useful but not in FR3-4 explicitly. Suggest: yes, surface in the live dashboard but as a read-only flag, not a list of reasons (privacy).
- Test database setup: Vitest's setup with a separate test database vs. transactions-rolled-back-after-each-test? Suggest the latter for speed.

This plan will be longer than Inc 1 or Inc 2. That's expected — this is the heart of the system.

Wait for plan approval. Guard phrase: "address all notes, don't implement yet"

If the plan is too large to implement in one sprint, propose splitting it into Sprint 3a (backend + tests) and Sprint 3b (frontend), with each having its own PLAN.md.
```

## What to expect

Claude Code produces `increments/03-scan-pipeline/PLAN.md`. **This plan deserves the most careful review of any increment.**

Specific things to check:
- **Pipeline order matches the sequence diagram exactly** — QR → Device → IP → GPS Accuracy → Geofence
- **AuditLogger always runs** — even on success, even on early failure
- **Each validator is its own file** — `qr-validator.js`, `device-checker.js`, etc.
- **ScanVerifier short-circuits** — first failure stops the chain (except audit log)
- **Open questions answered** — fail-open ip-api, single-use semantics, offline retention, audit visibility, test DB strategy
- **Concurrency test is in the plan** — 60 concurrent scans is FR N3
- **Error responses match the FR4.8 spec** — specific message per layer
- **Socket.IO authentication** — the socket connection is auth'd, not anonymous

## If the plan suggests a split

If Claude Code proposes Sprint 3a + 3b, that's a good sign. Run them sequentially:

1. Approve and run 3a (backend) until ✅
2. Test the backend with curl + a Socket.IO client (can be a separate Node script)
3. Then run 3b (frontend) — Claude Code will read 3a's PLAN.md and implementation as context

## Estimated time

If single sprint:
- Plan: 5-8 minutes (it's a big one)
- Iteration: 15-30 minutes (multiple rounds expected)
- Implementation: 60-90 minutes
- Review: 20-30 minutes (test thoroughly!)

**Total: ~2-3 hours** for Inc 3 if single sprint.

If split into 3a + 3b: same total time, but spread across two clean sessions.
