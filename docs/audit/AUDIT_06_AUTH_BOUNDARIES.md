# AUDIT 06: Authentication & Authorization Boundary Audit

**Date:** 2026-04-18
**Auditor:** Claude Opus 4.7 (READ-ONLY automated audit)
**Scope:** All API routes in `src/backend/routes/*.js`, controllers they delegate to, Socket.IO handlers in `services/socket-service.js`, and middleware in `middleware/auth-middleware.js`.
**Verdict:** 1 CRITICAL, 2 HIGH, 5 MEDIUM, 4 LOW, 2 INFO findings.

Items already resolved per `docs/SESSION_REPORT_FULL.md` (session fixation via `regenerate`, Socket.IO auth & enrollment check, IDOR on `getPerStudentReport`, rate limiting on verify/forgot/resend, open-redirect validation, device binding moved to scan pipeline, getQr auth) are **not repeated** here. This audit surfaces only *new* findings.

---

## 1. Middleware Summary

**`requireAuth`** (`middleware/auth-middleware.js:9-14`)
- Gates every route below by checking `req.session?.userId`.
- Uses optional chaining so malformed / empty sessions fall through cleanly to 401. Safe against tampered `session.userId = undefined`.
- Does NOT inspect `req.session.role`, `req.session.email`, or other fields — role enforcement is delegated to `requireRole`.

**`requireRole(role)`** (`middleware/auth-middleware.js:21-28`)
- Strict equality check on `req.session?.role` against a single string.
- Returns 403 with the exact role in the error message (minor disclosure: confirms the endpoint's required role to unauthorized callers).

**Session storage** — PG-backed (`connect-pg-simple`), `httpOnly`, `sameSite: 'lax'`, `secure` only in production. Cookie `maxAge = SESSION_MAX_AGE_MS`. The login handler calls `req.session.regenerate()` before setting identity fields (server.js + auth-controller.js:183-190), so session fixation IS mitigated.

**What mutates `req.session`?** — Only `login` (post-regenerate, sets userId/email/name/role) and `logout` (`destroy`). No middleware or controller writes to `req.session` after login. Good.

---

## 2. Full Endpoint Matrix

Legend: ✅ applied / ❌ missing / N/A not applicable. "Ownership" = server-side verification that the authenticated principal owns/is enrolled in the target resource.

| # | Method | Path | File:Line | requireAuth | requireRole | Ownership/Enrollment | Notes / Findings |
|---|--------|------|-----------|-------------|-------------|----------------------|------------------|
| 1 | POST | `/api/auth/register` | auth-routes.js:19 | N/A (public) | N/A | N/A | **F-01** (CRITICAL): role is chosen by the client; anyone can self-register as `instructor`. |
| 2 | POST | `/api/auth/login` | auth-routes.js:20 | N/A (public) | N/A | N/A | Session regenerates. **F-10** lockout bypass via forgot-password (see below). |
| 3 | POST | `/api/auth/logout` | auth-routes.js:21 | ✅ | N/A | Self only | `session.destroy` + cookie clear. Clean. |
| 4 | POST | `/api/auth/verify-code` | auth-routes.js:22 | N/A (public) | N/A | Token-bound | OK. Loginlimiter applied. |
| 5 | GET | `/api/auth/verify-email` | auth-routes.js:23 | N/A (public) | N/A | Token-bound | **F-05** token in URL query string (logs/referrer leak). Also handles `device_rebind` purpose — see F-06. |
| 6 | POST | `/api/auth/forgot-password` | auth-routes.js:24 | N/A (public) | N/A | Email-bound | 200-on-enumeration-safe; invalidates prior tokens. |
| 7 | POST | `/api/auth/resend-verification` | auth-routes.js:25 | N/A (public) | N/A | Email-bound | OK. |
| 8 | POST | `/api/auth/reset-password` | auth-routes.js:26 | N/A (public) | N/A | Token-bound | **F-02** (HIGH): successful reset does NOT destroy existing sessions. |
| 9 | POST | `/api/auth/request-rebind` | auth-routes.js:27 | ✅ | Inline `role==='student'` | Self only | **F-06** (MEDIUM): student role checked inline, not via `requireRole('student')`. Works, but diverges from pattern. |
| 10 | GET | `/api/auth/verify-rebind` | auth-routes.js:29 | N/A (public) | N/A | Token-bound | Same handler as verify-email. Does NOT destroy student's existing sessions after unbinding device (see F-06). |
| 11 | GET | `/api/auth/me` | auth-routes.js:30 | ✅ | N/A | Self only (session.userId) | OK. |
| 12 | POST | `/api/courses` | course-routes.js:21 | ✅ | ✅ instructor | N/A (creating) | OK. `instructorId` taken from `req.session.userId`, not body. |
| 13 | GET | `/api/courses` | course-routes.js:22 | ✅ | (role-aware) | Filters by session.userId | OK — splits by role internally. |
| 14 | POST | `/api/courses/enroll` | course-routes.js:23 | ✅ | ✅ student | N/A | OK. Uses session.userId. |
| 15 | GET | `/api/courses/:id` | course-routes.js:24 | ✅ | (role-aware) | ✅ instructor-owns OR student-enrolled | OK. |
| 16 | PUT | `/api/courses/:id` | course-routes.js:25 | ✅ | ✅ instructor | ✅ `getCourseForInstructor` | OK. |
| 17 | POST | `/api/courses/:id/enroll` | course-routes.js:26 | ✅ | ✅ student | Code verified | OK. |
| 18 | DELETE | `/api/courses/:id/students/:studentId` | course-routes.js:27 | ✅ | ✅ instructor | ✅ course ownership | OK. |
| 19 | GET | `/api/courses/:id/students` | course-routes.js:29 | ✅ | ✅ instructor | ✅ course ownership | OK. |
| 20 | POST | `/api/courses/:id/sessions` | course-routes.js:30 | ✅ | ✅ instructor | ✅ course ownership | OK. |
| 21 | PATCH | `/api/courses/:id/sessions/:sessionId` | course-routes.js:31 | ✅ | ✅ instructor | ✅ course ownership + `AND sessionId=…` | OK. |
| 22 | POST | `/api/sessions/:id/start` | session-routes.js:8 | ✅ | ✅ instructor | ✅ owns course via session.courseId | **F-07** (LOW): 404 vs 403 distinguishes session existence. |
| 23 | POST | `/api/sessions/:id/stop` | session-routes.js:9 | ✅ | ✅ instructor | ✅ owns course | Same 404/403 leak (F-07). |
| 24 | GET | `/api/sessions/:id/qr` | session-routes.js:10 | ✅ | (role-aware inline) | ✅ instructor-owns OR student-enrolled | OK. 404/403 leak (F-07). |
| 25 | POST | `/api/sessions/:id/override` | session-routes.js:11 | ✅ | ✅ instructor | ✅ owns course | **F-08** (MEDIUM): does not verify `studentId` in body is enrolled in the course. |
| 26 | POST | `/api/scan` | scan-routes.js:8 | ✅ | ✅ student | Enforced by `verifyScan` pipeline | OK. |
| 27 | GET | `/api/me/attendance` | report-routes.js:15 | ✅ | ✅ student | Self (session.userId) | OK. |
| 28 | GET | `/api/courses/:id/attendance` | report-routes.js:18 | ✅ | ✅ instructor | ✅ owns course | OK. |
| 29 | GET | `/api/courses/:id/attendance.csv` | report-routes.js:19 | ✅ | ✅ instructor | ✅ owns course | OK. |
| 30 | GET | `/api/courses/:id/attendance/student/:studentId` | report-routes.js:20 | ✅ | (role-aware, inline) | ✅ instructor-owns OR self+enrolled | **F-09** (MEDIUM): instructor branch does not verify `:studentId` is enrolled in `:id` — cross-course info leak on the student name/universityId lookup. |
| 31 | GET | `/api/courses/:id/audit-log` | report-routes.js:21 | ✅ | ✅ instructor | ✅ owns course | OK. |
| 32 | Socket.IO | `connection` | socket-service.js:58-64 | ✅ (via session cookie) | N/A | N/A | OK — disconnects unauthenticated sockets. |
| 33 | Socket.IO | `join-session` | socket-service.js:66-76 | ✅ | (role-aware) | ✅ `canAccessSession` | OK. Room cap `> 5` includes default socket.id room, so effective cap ≈ 4 session rooms. |
| 34 | Socket.IO | `leave-session` | socket-service.js:78-80 | ✅ | N/A | N/A | No authz needed (idempotent). |

**Coverage check:** every export in `routes/*.js` appears above. No orphan handlers.

---

## 3. Findings (new, not already in SESSION_REPORT_FULL)

### F-01 — CRITICAL — Self-serve instructor registration (privilege escalation)
**File:** `src/backend/controllers/auth-controller.js:28, 70-110`
**Endpoint:** `POST /api/auth/register`
**Evidence:**
```js
role: z.enum(['student', 'instructor']),
…
const [user] = await tx.insert(users).values({ email, passwordHash, name, role }).returning();
```
`role` is accepted directly from the request body. Any attacker with a valid `@auk.edu.kw` email (or one spoofed if the university's SMTP accepts forwarded-from) can register with `"role": "instructor"`. Once their email is verified and they log in, they have full instructor capabilities: create courses, override attendance, export CSVs of enrolled students, view audit logs. There is no admin approval step, no employee-ID→DB cross-check, and no out-of-band verification that the `employeeId` string they supply belongs to a real staff record.

**Exploit:**
```bash
curl -X POST http://host/api/auth/register -H 'content-type: application/json' -d '{
  "email":"rogue@auk.edu.kw","password":"passw0rd","name":"Evil",
  "role":"instructor","employeeId":"X"
}'
# ...verify email...
# now create a course, set enrollment code, trick students into joining,
# or override any already-enrolled student's attendance in a course you control.
```
**Recommendation:** require instructor accounts to be pre-provisioned (admin-created or from an allowlist of `employeeId`s tied to an HR feed). At minimum, gate `role === 'instructor'` behind an out-of-band approval queue.

---

### F-02 — HIGH — Password reset does not invalidate existing sessions
**File:** `src/backend/controllers/auth-controller.js:365-372`
**Endpoint:** `POST /api/auth/reset-password`
**Evidence:**
```js
await db.transaction(async (tx) => {
  await tx.update(users).set({ passwordHash, failedLoginCount: 0, lockedUntil: null })…
  await tx.update(emailVerificationTokens).set({ usedAt: new Date() })…
});
```
The transaction updates the password hash and consumes the token, but does **not** delete rows from the `session` table (the `connect-pg-simple` store). Any attacker who previously obtained the victim's session cookie retains valid access for the cookie's full `SESSION_MAX_AGE_MS` window, **after** the victim reset their password in response to the compromise.

**Exploit:** attacker steals cookie → victim suspects compromise, resets password → attacker's cookie still authenticates all endpoints until cookie expiry.

**Recommendation:** inside the reset transaction, `DELETE FROM session WHERE sess::jsonb ->> 'userId' = $userId`, or store a `session_version` on the user row that `requireAuth` compares against.

---

### F-03 — HIGH — Account lockout bypass via forgot-password
**File:** `src/backend/controllers/auth-controller.js:368`
**Endpoints:** `POST /api/auth/forgot-password` → `POST /api/auth/reset-password`
**Evidence:** `resetPassword` unconditionally sets `failedLoginCount: 0, lockedUntil: null`.
Combined with `forgot-password` being accessible without any auth, an attacker who guessed enough wrong passwords to lock an account (or an attacker who wants to mask a brute-force attempt) can issue a reset request (which never tells them whether the email exists), then — if they **also** control the target email inbox — complete the reset and unlock the account at the same time. More importantly, if a **victim** rate-limits themselves out by mistyping, the attacker who is watching `failedLoginCount` via timing cannot tell, but the lockout-as-a-defense-against-brute-force signal is weakened: `lockedUntil` expires naturally, but reset-triggered lockout-clearing bypasses any "permanent after N lockouts" policy if one is added later.
The concrete vulnerability today is smaller (attacker still needs email access to complete), but the code path is worth tightening for defense in depth.

**Recommendation:** only clear `failedLoginCount` and `lockedUntil` after the user's next successful login, not on reset. Or leave `lockedUntil` intact and require a successful login after reset to unlock.

---

### F-04 — MEDIUM — `verify-email` / `verify-rebind` uses single-use tokens but does not destroy student's sessions on device rebind
**File:** `src/backend/controllers/auth-controller.js:257-274`
**Endpoint:** `GET /api/auth/verify-rebind?token=…`
**Evidence:** the `device_rebind` branch of `verifyEmail` clears `students.deviceFingerprint` and `deviceBoundAt` but leaves the student's existing session rows untouched. If an attacker has stolen both the victim's session cookie AND access to the victim's email, they can issue `POST /api/auth/request-rebind` using the stolen cookie, click the link, and the victim's old session cookie continues to work. In the normal-use case (student lost their old phone and wants to bind a new one) this is benign. In a session-hijack scenario it means the attacker can survive a user-initiated device rebind.

Also: the rebind email link delivers the token in a **GET** query parameter. Query strings are logged by proxies, shown in browser history, and forwarded in `Referer` headers if the verification success page links to any third-party asset. Same applies to password-reset links (token in URL body, not query — slightly better).

**Recommendation:** treat `device_rebind` as a high-trust action — after clearing the fingerprint, delete all session rows for that user and require re-login. Consider moving the token to a POST with a confirmation page.

---

### F-05 — MEDIUM — `overrideAttendance` does not verify target student is enrolled in the course
**File:** `src/backend/controllers/override-controller.js:18-86`
**Endpoint:** `POST /api/sessions/:id/override`
**Evidence:** after confirming the instructor owns the session's course, the handler takes `studentId` from the body and either updates an existing `attendance` row or inserts a new one with that `studentId` and the session. There is no check that `studentId` is an enrolled student of the course (or a student at all — could be an instructor's userId).

**Exploit:** an instructor can insert arbitrary `attendance` rows referencing user-IDs they've discovered elsewhere (e.g. from the `audit-log`, CSV export, or guessed UUIDs). The resulting row will pollute reports until noticed, and creates an `audit_log` entry falsely attributing an "override" event to a non-enrolled user. This is not cross-instructor (still scoped to the instructor's own session), but it breaks the invariant that `attendance.studentId` is always an enrolled student.

**Recommendation:** before the insert/update, `SELECT 1 FROM enrollments WHERE courseId=session.courseId AND studentId=$body.studentId AND removedAt IS NULL`.

---

### F-06 — MEDIUM — `getPerStudentReport` (instructor branch) does not verify `:studentId` is enrolled in `:id`
**File:** `src/backend/controllers/report-controller.js:81-130`
**Endpoint:** `GET /api/courses/:id/attendance/student/:studentId`
**Evidence:** the instructor branch (lines 85-89) only checks instructor-owns-course, then proceeds to load `users.name` and `students.universityId` for the supplied `:studentId` regardless of whether that user is enrolled.
```js
const [student] = await db.select({ name: users.name, universityId: students.universityId })
  .from(users).innerJoin(students, eq(users.userId, students.userId))
  .where(eq(users.userId, studentId)).limit(1);
```
**Exploit:** instructor A enumerates UUIDs (e.g. from their own course's students, from the `audit-log` `actor_id` column, or via a leak) and fetches `/api/courses/{OWNED_COURSE}/attendance/student/{ANY_USER}`. If that user is a student, the response returns their full name, university ID, and an empty session list (since they're not enrolled). If the user is an instructor, the join returns no row — minor 404. The `sessions` array is correctly scoped to the course so attendance data does not leak, but the student's name + universityId does.

Note the student branch on line 91-98 DOES correctly check enrollment — fix mentioned in SESSION_REPORT_FULL #9 addressed only the self-view side. This finding is the instructor-branch counterpart.

**Recommendation:** in the instructor branch, also verify `SELECT 1 FROM enrollments WHERE courseId=:id AND studentId=:studentId` before fetching the user row.

---

### F-07 — MEDIUM — Inline role check in `requestRebind` diverges from `requireRole` pattern
**File:** `src/backend/controllers/auth-controller.js:380-382`
**Endpoint:** `POST /api/auth/request-rebind`
**Evidence:** the route uses `requireAuth` only (auth-routes.js:27). The controller then does `if (req.session.role !== 'student')` inline. Functionally equivalent to `requireRole('student')`, but mixing styles makes it easy to miss role checks when adding new handlers. Low exploit potential; flagged for consistency.

**Recommendation:** move to `router.post('/request-rebind', requireAuth, requireRole('student'), requestRebind)`.

---

### F-08 — LOW — 404 vs 403 reveals resource existence
**Files:**
- `session-controller.js:15, 55, 85` (startSession/stopSession/getQr return 404 for missing session, 403 for wrong course)
- `course-controller.js:191` (getCourse returns 404 for missing course, 403 for not-owned/not-enrolled — better)
- `override-controller.js:29, 34` (returns 404 session + 403 not-your-course)
- `report-controller.js:89, 142, 236, 274` (various: 403 for not-your-course, 404 for missing)

**Evidence:** an unauthorized caller can distinguish "session UUID exists but isn't yours" (403) from "session doesn't exist" (404) across multiple endpoints. This leaks the existence and validity of any session/course UUID to any authenticated student or instructor.

**Exploit:** enumerate UUIDs → any UUID that returns 403 is known-valid; feed that into other probes (e.g. Socket.IO `join-session`, which is silent on failure — so 403 endpoints are the oracle).

**Recommendation:** return a uniform 404 when the caller isn't entitled to distinguish existence from non-existence. Preferred pattern: one combined query `WHERE sessionId=? AND (instructorId=? OR student enrolled)` → single 404 on miss.

---

### F-09 — LOW — `getPerStudentReport` returns student identity for any `:studentId` regardless of enrollment (self-branch)
**File:** `src/backend/controllers/report-controller.js:91-98, 121-125`
**Endpoint:** `GET /api/courses/:id/attendance/student/:studentId`
**Evidence:** the self branch correctly rejects `req.session.userId !== studentId` with 403 (line 91-93) and correctly requires the caller be enrolled in `:id` (line 95-98). But the `students` table join on line 121-125 runs unconditionally; if the student calls with their own `studentId` and an `:id` of a course they just unenrolled from (`removedAt IS NOT NULL`), the enrollment check fails — OK. However, if a student passes their OWN `studentId` but a course ID they've never enrolled in, they get 403 "Not enrolled". Safe.

The corner case: the student's self branch is fine in current code. **This sub-finding is INFO only** — no fix needed, noting it here to document that the self-branch IS correctly scoped (auditor's due diligence).

---

### F-10 — LOW — `removeStudent` does not verify the `:studentId` path parameter is actually a student role
**File:** `src/backend/controllers/course-controller.js:308-333`
**Endpoint:** `DELETE /api/courses/:id/students/:studentId`
**Evidence:** looks up the enrollment row only. If an enrollment row somehow exists for a non-student user (should be impossible via `enrollByCode`/`enrollInCourse` because those route through `requireRole('student')`, but possible via direct DB manipulation), `removeStudent` would happily soft-delete it. Not exploitable via API today; flagged as a defense-in-depth note.

---

### F-11 — INFO — `requireRole` error message discloses required role
Error body: `{ error: "Requires instructor role" }` tells an attacker what role the endpoint expects. Not exploitable in isolation (attacker could infer from path), but worth genericizing to `"Forbidden"`.

---

### F-12 — INFO — Socket.IO room cap off-by-one
**File:** `src/backend/services/socket-service.js:70`
`if (socket.rooms.size > 5) return;` — `socket.rooms` always includes the default `socket.id` auto-room, so effective custom-room cap is 4 session rooms, not 5. Behavior is safe (conservative) but the comment/intent say 5. Low-value nit.

---

## 4. Cross-Tenant Exploitation Matrix

Attempted manually enumerated attacks; all **blocked** unless noted.

| Attack | Result |
|---|---|
| Student A hits `POST /api/courses` | 403 (requireRole) ✅ |
| Student A hits `POST /api/sessions/:id/start` | 403 ✅ |
| Student A hits `POST /api/sessions/:id/override` with another student's ID | 403 ✅ |
| Instructor hits `POST /api/scan` | 403 ✅ |
| Instructor hits `GET /api/me/attendance` | 403 ✅ |
| Instructor B calls `PUT /api/courses/{A_COURSE}` | 404 (via `getCourseForInstructor`) ✅ |
| Instructor B calls `GET /api/courses/{A_COURSE}/audit-log` | 404 ✅ |
| Student B calls `GET /api/courses/{A_COURSE}` (not enrolled) | 403 ✅ |
| Student B calls `GET /api/sessions/{A_SESSION}/qr` (not enrolled) | 403 ✅ |
| Student B calls `GET /api/courses/X/attendance/student/{A_UUID}` (self-branch) | 403 "Cannot view another student's" ✅ |
| Student A calls `POST /api/scan` from wrong device | handled by DeviceChecker layer ✅ (pre-fixed) |
| Socket.IO `join-session` with another course's sessionId | silent no-op (authz check) ✅ |
| Instructor A calls `GET /api/courses/{A_COURSE}/attendance/student/{UUID_OF_ANYONE}` | **partial leak** — see F-06 ⚠️ |
| Instructor A calls `POST /api/sessions/{A_SESSION}/override` with any UUID as studentId | **insert succeeds** — see F-05 ⚠️ |
| Any authenticated user probes `/api/sessions/{UUID}/start` to check if UUID exists | **existence oracle** — see F-07 ⚠️ |
| Anyone registers with `role: "instructor"` | **succeeds** — see F-01 🔴 |
| Attacker with stolen cookie survives password reset | **succeeds** — see F-02 🟠 |

---

## 5. Conclusion

The middleware stack (`requireAuth` + `requireRole`) is correctly wired on every route, and cross-tenant access between instructors and between students is uniformly blocked by scoped SQL predicates (instructorId = session.userId, enrollments.studentId = session.userId with removedAt IS NULL). The Socket.IO layer is solid post-fix. Session fixation, IDOR on per-student report (self-branch), and device-binding-at-login concerns from the prior audit pass have been correctly addressed.

**New residual risks, in priority order:**
1. **F-01 (CRITICAL)** — client-chosen role at registration allows unbounded instructor-account creation. This is the single highest-impact finding and should be fixed before go-live.
2. **F-02 (HIGH)** — sessions outlive password resets.
3. **F-03 (HIGH)** — lockout state is cleared by password reset, weakening brute-force defenses.
4. **F-04–F-06 (MEDIUM)** — three instances of "ownership check present but incomplete" (rebind doesn't destroy sessions; override doesn't verify enrollment; per-student report instructor branch doesn't verify enrollment).
5. **F-07–F-12 (LOW/INFO)** — 404/403 existence oracle, role-disclosure in error messages, Socket.IO room-cap off-by-one, inline role check style drift.

Recommended minimum fix set before production: **F-01, F-02, F-05, F-06**. F-03 and F-04 are defense-in-depth but valuable. F-07 onward are hygiene.
