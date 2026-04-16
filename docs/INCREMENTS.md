<!--
last_updated: 2026-04-16
verified_against: FRS v1.1
audience: Claude Code (the spec for implementation), maintainer (progress tracking)
role: the canonical 5-increment plan with binary acceptance criteria
-->

# INCREMENTS.md

> The 5 increments that make up QR-Guard. Each increment is a self-contained, testable unit. An increment is **not done** until every acceptance criterion below it passes. Increments must be built in order — Inc 3 depends on Inc 1 and Inc 2.

---

## Increment 1 — Authentication & accounts

**Implements:** FR1.1 through FR1.8

**Scope:**
- Student registration (university ID, name, @auk.edu.kw email, password)
- Instructor registration (employee ID, name, @auk.edu.kw email, password)
- Email + password login
- Email verification flow (24h token expiry)
- Password reset flow (1h token expiry)
- Account lockout after 5 failed login attempts
- Device binding via FingerprintJS (one device per student per semester)
- Role-based dashboards (different routes for student vs instructor)

**Out of scope (deferred):**
- Password complexity rules (use bcrypt 12 rounds, accept any length ≥ 8)
- Two-factor authentication
- OAuth/SSO

**Acceptance criteria:**
1. ✅ A student can register with valid @auk.edu.kw credentials and receive a verification email
2. ✅ A student cannot register with a non-AUK email — server-side rejection with clear error
3. ✅ Login fails until the verification link is clicked
4. ✅ After verification, login succeeds and redirects to the student dashboard
5. ✅ An instructor can register and is redirected to the instructor dashboard on login
6. ✅ A student's first login captures their device fingerprint and stores it
7. ✅ A second login attempt from a different browser is rejected with "Device not recognized"
8. ✅ The instructor can re-bind a student's device via a verified email link (FR1.7)
9. ✅ 5 failed login attempts in succession lock the account; recovery is via email only
10. ✅ Password reset email arrives, link works, token expires after 1 hour
11. ✅ Passwords in the database are bcrypt hashes (never plaintext)
12. ✅ All routes that require authentication return 401 when called without a valid session
13. ✅ Student dashboard route returns 403 when called by an instructor account, and vice versa

**Dependencies:** none (this is the foundation)

**Estimated effort:** 1 sprint (~30-60 minutes with Claude Code)

---

## Increment 2 — Course management

**Implements:** FR2.1 through FR2.8

**Scope:**
- Instructor creates courses (name, code, section, semester, weekly schedule)
- Auto-generated 6-character alphanumeric enrollment code per course
- Student enrolls via code (duplicate enrollment rejected)
- Instructor views enrolled students with live attendance %
- Instructor can remove students (historical records retained)
- Geofence configuration per course (lat, lng, radius) with map preview
- Configurable thresholds per course (attendance window, warning threshold, QR refresh interval)
- Auto-generation of sessions from weekly schedule (with cancel/add ad-hoc)

**Out of scope (deferred):**
- Bulk student import (CSV upload)
- Multi-instructor courses
- Course templates / cloning

**Acceptance criteria:**
1. ✅ Instructor can create a course; the course appears on their dashboard with a unique 6-char enrollment code
2. ✅ Two courses cannot share the same enrollment code (server enforces uniqueness)
3. ✅ Student can enroll using a valid code; the course appears on their dashboard
4. ✅ Student cannot enroll twice in the same course (clear error message)
5. ✅ Instructor can configure the geofence (lat, lng, radius) and see a map preview before saving
6. ✅ Geofence radius accepts values from 10m to 500m; out-of-range values rejected
7. ✅ Instructor can configure attendance window, warning threshold, and QR refresh interval per course
8. ✅ Instructor can remove a student from a course; past attendance records remain queryable
9. ✅ Sessions are auto-generated from the weekly schedule for the semester duration
10. ✅ Instructor can cancel an auto-generated session or add an ad-hoc session

**Dependencies:** Inc 1 (auth required for course creation/enrollment)

**Estimated effort:** 1 sprint

---

## Increment 3 — Dynamic QR & scan pipeline

**Implements:** FR3.1 through FR3.6, FR4.1 through FR4.10

**This is the critical-path increment. Test thoroughly.**

**Scope:**
- Instructor starts a session → full-screen dynamic QR appears
- QR token = session ID + server timestamp + geofence coords (Base64)
- WebSocket pushes new token every 25 sec (configurable per course)
- Fallback to HTTP polling at 10 sec if WebSocket disconnects
- Single-use enforcement per student per refresh cycle (rescan returns "Already recorded")
- Live counter on instructor view: checked-in / total enrolled
- Manual stop or auto-close after attendance window expires
- Student web UI: tap "Scan" → camera activates → decodes QR
- Browser Geolocation API call with accuracy field
- POST `/api/scan` with `{qrPayload, gpsLat, gpsLng, gpsAccuracy, deviceFingerprint, clientIp}`
- **Full 6-layer scan pipeline (in order — see `docs/uml/02-sequence-scan.svg`):**
  1. `QrValidator` — token valid for current refresh cycle?
  2. `DeviceChecker` — fingerprint matches stored binding?
  3. `IpValidator` — country = Kuwait, no VPN/proxy flag?
  4. `GpsAccuracyChecker` — accuracy ≤ 150m and ≠ 0?
  5. `GeofenceChecker` — PostGIS ST_DWithin (radius + 15m margin)?
  6. `AuditLogger` — append every attempt with full context
- Specific error message per failure layer (per FR4.8)
- Successful scans recorded with: student ID, session ID, timestamp, GPS, IP, accuracy, device hash
- Offline queue (local cache, auto-submit on reconnect, within window)

**Out of scope (deferred):**
- Bulk QR generation for hybrid in-person + remote sessions
- Multi-device backup scanning
- Bluetooth proximity verification

**Acceptance criteria:**
1. ✅ Starting a session displays a QR code that visibly refreshes every 25 sec
2. ✅ Stopping the WebSocket server and reloading triggers HTTP polling fallback within 10 sec
3. ✅ Scanning a current QR with valid GPS, device, and IP records attendance and shows green checkmark in ≤3 sec (FR N1)
4. ✅ Scanning the same QR a second time returns "Already recorded"
5. ✅ Scanning an expired QR returns "QR expired — wait for refresh"
6. ✅ Scanning from a different device returns "Device not recognized"
7. ✅ Scanning while VPN-connected (or test mock returning country ≠ Kuwait) returns "Location verification failed"
8. ✅ Scanning with mocked GPS accuracy of 0 or 200 returns "Location verification failed"
9. ✅ Scanning from outside the geofence (mocked GPS) returns "Outside classroom area"
10. ✅ Every scan attempt (success and failure) creates an audit log row with full context
11. ✅ Pipeline order confirmed by integration test: cheapest checks first, fail-fast on first failure
12. ✅ Live counter on instructor dashboard updates in real-time as students scan
13. ✅ Manual session stop closes the QR display and rejects subsequent scans
14. ✅ 60 concurrent simulated scans complete with no errors (FR N3)

**Dependencies:** Inc 1 (auth, device binding), Inc 2 (course config, geofence)

**Estimated effort:** 2 sprints (the hardest increment — split DB+server from frontend)

---

## Increment 4 — Reports & analytics

**Implements:** FR5.1 through FR5.7

**Scope:**
- Attendance % calculation: (present sessions / total held) × 100, per student per course
- Excused sessions excluded from denominator
- Per-session report: student list with status, timestamps, GPS coords
- Per-student report: all sessions with statuses and running %
- Student self-view: own history + % per course on student dashboard
- CSV export with date range / student / status filters
- Real-time session dashboard for instructor: enrolled, present, absent, %
- "At-risk" flag (≤85%) visible on instructor's enrolled student list

**Out of scope (deferred):**
- PDF export
- Cross-course aggregate analytics
- Email-delivered reports
- Charts / graphs (text + table only)

**Acceptance criteria:**
1. ✅ Per-session report shows correct student count and status for a session with mixed attendance
2. ✅ Per-student report shows the same data when filtered to one student
3. ✅ % calculation matches manual count for: 0 sessions held (returns N/A), 1 session, many sessions
4. ✅ Excused sessions correctly excluded from % calculation denominator
5. ✅ Student self-view shows the student their own history and % per enrolled course
6. ✅ A student cannot view another student's attendance via the API (403)
7. ✅ CSV export downloads with correct headers and one row per attendance record
8. ✅ CSV filters work: by date range, by student, by status
9. ✅ Real-time dashboard updates as scans come in (uses same WebSocket as Inc 3)
10. ✅ At-risk flag (≤85%) appears next to student names in the enrolled student list

**Dependencies:** Inc 3 (need attendance data to report on)

**Estimated effort:** 1 sprint

---

## Increment 5 — Notifications, override, audit, hardening

**Implements:** FR6.1 through FR6.4, FR7.1 through FR7.3

**Scope:**
- Warning email when student's % crosses below threshold (one email per crossing, not per absence)
- Instructor notification when student exceeds AUK 15% absence limit
- Email content: name, course, current %, absence count, threshold
- Optional: per-session scan confirmation email to student
- Manual override: instructor marks any student present/absent for any session
- Override audit log: instructor ID, student ID, session, timestamp, old status, new status, reason
- Excuse absence with reason (excludes from % denominator)
- **Hardening pass:** review all error paths, ensure audit log is append-only, lock down RLS-equivalent middleware, security headers, rate limiting on auth and scan endpoints

**Out of scope (deferred):**
- SMS notifications
- Push notifications
- Customizable email templates

**Acceptance criteria:**
1. ✅ When a student's % drops below the threshold, exactly one warning email is sent
2. ✅ Subsequent absences below threshold do not trigger more emails (one per crossing, not per absence)
3. ✅ Recovering above threshold and dropping below again triggers a new email
4. ✅ Email content includes name, course, current %, absence count, threshold
5. ✅ Instructor receives a notification when any student exceeds the AUK 15% limit
6. ✅ Instructor can override any student's status for any session, with required reason
7. ✅ Override creates an audit log entry with old + new status + reason + timestamp + instructor ID
8. ✅ Audit log entries cannot be modified or deleted (only appended); attempting to do so returns 403
9. ✅ Excused sessions correctly excluded from % calculation (verified by Inc 4 test re-run)
10. ✅ Rate limiting on `/api/login` (5 failed in 10 min) and `/api/scan` (60/min per IP)
11. ✅ Security headers set: HSTS, X-Frame-Options DENY, X-Content-Type-Options nosniff, CSP
12. ✅ Manual penetration smoke test: cannot bypass auth, cannot escalate role, cannot read other users' data

**Dependencies:** Inc 4 (need % calculation for threshold detection)

**Estimated effort:** 1 sprint

---

## Increment dependency chain

```
Inc 1 (auth) ──┐
               ├──► Inc 3 (scan pipeline) ──► Inc 4 (reports) ──► Inc 5 (notifications + hardening)
Inc 2 (courses) ┘
```

Inc 1 and Inc 2 can be built in either order or in parallel. Everything else is sequential.

---

## When an increment is done

Before marking an increment complete in `docs/STATE.md`:

- [ ] All acceptance criteria above are checked
- [ ] All Vitest tests pass (`npm test`)
- [ ] ESLint is clean (`npm run lint`)
- [ ] Manual smoke test: log in, perform the increment's primary flow, verify outcome
- [ ] `docs/CODEBASE_MAP.md` is updated
- [ ] `docs/STATE.md` increment row is updated to ✅ with date
- [ ] Commit pushed: `feat(inc-<n>): <one-line description>`
