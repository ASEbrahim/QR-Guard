<!--
last_updated: 2026-04-18
audience: Claude Code (locate files), maintainer (review structure), professor (code walkthrough)
role: a one-line description of every code file in the project
-->

# CODEBASE_MAP.md

> Every code file in the project, with a one-line description. Updated after every implementation session.

---

## Status

All complete. 8 audits passed. Security hardened. Deployed to qrguard.strat-os.net

---

## Project Root

| File | Purpose |
|---|---|
| `package.json` | Project config: ESM, scripts (dev, start, test, lint, db:push), 17 prod + 8 dev dependencies |
| `eslint.config.js` | ESLint flat config: recommended rules, Node.js globals, Vitest globals |
| `.prettierrc` | Prettier config: single quotes, trailing commas, 100 print width |
| `drizzle.config.js` | Drizzle Kit config: PostgreSQL dialect, schema path, DB URL from env |
| `vitest.config.js` | Vitest config: Node environment, sequential file execution, env vars for test DB |
| `render.yaml` | Render deployment blueprint: build/start commands, env var declarations |
| `CLAUDE.md` | Claude Code instructions: rules, key files, stack, code style |
| `.env.example` | Template for environment variables (DATABASE_URL, SESSION_SECRET, EMAIL_PROVIDER, etc.) |
| `.gitignore` | Ignores node_modules, .env, dist, coverage, logs |

---

## Backend — Config (`src/backend/config/`)

| File | Purpose |
|---|---|
| `constants.js` | All named constants: BCRYPT_ROUNDS, lockout durations, token expiry times, geofence limits, AUK email regex, GPS accuracy threshold, IP API timeout, AUK absence limit %, enrollment code alphabet + max retries |
| `database.js` | Drizzle ORM connection via node-postgres Pool. SSL enabled when NODE_ENV=production (for Neon). Exports `db` (Drizzle instance) and `pool` (raw pg Pool) |

---

## Backend — Database Schema (`src/backend/db/schema/`)

Each file defines one Drizzle table. All tables use UUID primary keys via `gen_random_uuid()`.

| File | Table | Key columns | Notes |
|---|---|---|---|
| `user.schema.js` | `users`, `students`, `instructors` | email (unique), passwordHash, role, failedLoginCount, lockedUntil; universityId, deviceFingerprint; employeeId | Three tables: base user + role-specific extensions. Students have device binding. Instructors are exempt from device checks. |
| `token.schema.js` | `email_verification_tokens` | token (PK), userId, purpose (email_verify/password_reset/device_rebind), expiresAt, usedAt | 6-digit codes for email verification, 64-char hex tokens for reset/rebind |
| `course.schema.js` | `courses` | instructorId, code, section, enrollmentCode (unique 6-char), geofenceCenter (WKT text), geofenceRadiusM, weeklySchedule (JSONB), semesterStart/End | Geofence stored as WKT string, cast via ST_GeogFromText() for PostGIS queries |
| `enrollment.schema.js` | `enrollments` | courseId + studentId (composite PK), removedAt (soft-delete) | Many-to-many. Soft-delete retains historical records |
| `session.schema.js` | `sessions` | courseId, scheduledStart/End, actualStart/End, status (scheduled/active/closed/cancelled) | Auto-generated from weekly schedule. Index on (courseId, scheduledStart) |
| `qr-token.schema.js` | `qr_tokens` | sessionId, payload (unique Base64), generatedAt, expiresAt | New token every 25 seconds. Index on (sessionId, generatedAt DESC) |
| `attendance.schema.js` | `attendance` | sessionId + studentId (unique), status, gpsLat/Lng, gpsAccuracyM, ipAddress (text), deviceHash, excuseReason | One row per student per session. ip_address stored as text (not inet) for Drizzle compatibility |
| `audit-log.schema.js` | `audit_log` | eventType, actorId, targetId, result, reason, details (JSONB) | Append-only: DB triggers reject UPDATE/DELETE. Indexes on timestamp DESC and actorId |
| `warning-email-log.schema.js` | `warning_email_log` | courseId + studentId + crossedBelowAt (composite PK), recoveredAboveAt | One-per-crossing email semantics. New row on each threshold crossing |
| `index.js` | — | Re-exports all 10 table schemas | Single import point for all schemas |

---

## Backend — Middleware (`src/backend/middleware/`)

| File | Purpose |
|---|---|
| `auth-middleware.js` | `requireAuth` (checks session, returns 401) and `requireRole(role)` (checks role, returns 403). Instructors exempt from device binding — documented in code comment |
| `rate-limiter.js` | Four express-rate-limit configs: login (5/10min), register (10/hr), scan (60/min), global (200/min). All skipped in dev mode via `skip` option |

---

## Backend — Routes (`src/backend/routes/`)

| File | Endpoints | Auth |
|---|---|---|
| `auth-routes.js` | POST register, login, logout, verify-code, resend-verification, forgot-password, reset-password, request-rebind; GET verify-email, verify-rebind, me | Mixed: register/login/verify public, rest require auth |
| `course-routes.js` | POST create, enroll (by code); GET list, detail, students; PUT update; DELETE remove student; POST/PATCH sessions | All require auth. Create/update/delete require instructor role |
| `session-routes.js` | POST start, stop, override; GET qr (polling fallback) | Start/stop/override: instructor only. QR: any auth'd with enrollment check |
| `scan-routes.js` | POST /api/scan | Student only |
| `report-routes.js` | GET per-session, per-student, CSV, self-view, audit-log | Instructor for reports, student for self-view |

---

## Backend — Controllers (`src/backend/controllers/`)

| File | Responsibility | Key functions |
|---|---|---|
| `auth-controller.js` | All authentication flows. Zod validation on all inputs. generateHexToken() for links, generateSixDigitCode() for email OTP | register, login, logout, verifyCode, verifyEmail, forgotPassword, resendVerification, resetPassword, requestRebind, getMe |
| `course-controller.js` | Course CRUD, enrollment, session management. Shared `executeEnrollment()` helper eliminates duplicate logic. `getCourseForInstructor()` ownership check | createCourse, listCourses, getCourse, updateCourse, enrollInCourse, enrollByCode, removeStudent, addSession, updateSession |
| `session-controller.js` | Start/stop QR sessions, HTTP polling fallback. Ownership + enrollment checks on getQr | startSession, stopSession, getQr |
| `scan-controller.js` | Receives scan POST, delegates to ScanVerifier, records attendance, broadcasts live counter via Socket.IO, triggers threshold notification | handleScan |
| `override-controller.js` | Instructor overrides student attendance status. Creates audit log entry. Triggers threshold notification | overrideAttendance |
| `report-controller.js` | All reporting: per-session, per-student, CSV export, student self-view, audit log viewer, roster with attendance % + at-risk flags. N+1 fixed via bulk inArray() fetch | getPerSessionReport, getPerStudentReport, exportCsv, getMyAttendance, getAuditLog, getEnrolledStudentsWithPct |

---

## Backend — Validators (`src/backend/validators/`)

The 6-layer scan pipeline. Each file is one validator. Order is law (per sequence diagram).

| File | Layer | Responsibility | On failure | Complexity |
|---|---|---|---|---|
| `qr-validator.js` | 1 | Decode Base64 payload, find non-expired token in DB | "QR expired — wait for refresh" | O(1) — indexed lookup |
| `device-checker.js` | 2 | Match FingerprintJS visitor ID against stored binding | "Device not recognized" | O(1) — PK lookup |
| `ip-validator.js` | 3 | Call ip-api.com: country=Kuwait, no VPN/proxy. FAIL-OPEN on timeout | "Location verification failed" | O(1) — external API call |
| `gps-accuracy-checker.js` | 4 | Reject if accuracy > 150m or === 0 (likely spoofed) | "Location verification failed" | O(1) — comparison |
| `geofence-checker.js` | 5 | PostGIS ST_DWithin via ST_GeogFromText() cast + 15m margin | "Outside classroom area" or "Course not found" (distinct codes) | O(1) — spatial index |
| `audit-logger.js` | 6 | Append every attempt to audit_log (success or failure). Never throws | — | O(1) — insert |
| `scan-verifier.js` | — | Orchestrator: runs 1-5 in order, short-circuits on first failure, 6 always runs in finally block. Returns {success, sessionId, courseId, reason, message} | — | O(1) total |
| `scan-error.js` | — | Custom ScanError class with `code` property for API response reason codes | — | — |

---

## Backend — Services (`src/backend/services/`)

| File | Purpose |
|---|---|
| `email-service.js` | Three-mode email abstraction: console (dev), resend (production via mail.strat-os.net), SMTP (placeholder). Styled HTML templates with AUK branding for verification code, password reset, device rebind. `sendVerificationCode()` sends 6-digit OTP with large monospace display |
| `enrollment-code.js` | Generates 6-char codes from filtered alphabet (no 0/O/1/I/L). Uses crypto.randomBytes. Retries on DB collision up to ENROLLMENT_CODE_MAX_RETRIES |
| `session-generator.js` | Generates session rows from weekly schedule JSON + semester date range. Uses date-fns for date math. Kuwait has no DST — documented in code |
| `attendance-calculator.js` | Shared % calculation using CTE with COALESCE for absent students (no attendance row → 'absent'). Excused excluded from denominator. Also `calculateAllAttendancePcts()` for bulk roster view |
| `notification-service.js` | Warning email on threshold crossing. One-per-crossing via warning_email_log. AUK 15% limit notification to instructor. Threshold check fires after every scan AND every override |
| `qr-service.js` | QR token generation (Base64 payload with sessionId, courseId, geofence coords). Refresh loop via setInterval. getCurrentToken for HTTP polling fallback (DESC sort for latest) |
| `socket-service.js` | Socket.IO initialization, room management (per session), event emitters: qr:refresh, attendance:update, session:closed |

---

## Backend — Server Entry Point

| File | Purpose |
|---|---|
| `server.js` | Express app: helmet (security headers), CORS, JSON parsing, express-session (PostgreSQL store via connect-pg-simple), trust proxy, per-route rate limiters, static file serving, Socket.IO attachment to HTTP server, 404 catch-all, error handler. Binds to 0.0.0.0 for Render deployment |

---

## Frontend — Scripts (`src/frontend/scripts/`)

| File | Purpose |
|---|---|
| `api.js` | Shared fetch wrapper with auth handling (401 → redirect to login). GET/POST/PUT/PATCH/DELETE helpers. showError(), showSuccess(), showPageLoader(), setButtonLoading(), showSkeletons(), checkAuthAndRedirect(), togglePassword(), esc() XSS helper |
| `components.js` | Shared UI components: renderNav(userName), renderNavWithBack(url, label), renderBottomNav(role, activePage), renderFooter(), doLogout(), loadUserName(). Single file for all nav/footer changes |
| `fingerprint.js` | FingerprintJS v4 open-source CDN integration. Lazy-loads on first call. Returns stable visitor ID for device binding |

---

## Frontend — Pages (`src/frontend/`)

| File | Role | Key features |
|---|---|---|
| `index.html` | Landing | Auto-redirects: no session → login, student → student dash, instructor → instructor dash |
| `login.html` | Auth | AUK logo (140px), password toggle, FingerprintJS on submit, "Resend verification" link on not-verified error (built via safe DOM methods, no innerHTML XSS) |
| `register.html` | Auth | Student-only registration (instructor field hidden). After submit, shows 6-digit code input step with resend link. Success shows checkmark + "Go to Login" |
| `forgot-password.html` | Auth | Single email input, always returns 200 (no email leak) |
| `reset-password.html` | Auth | Token from URL param, password toggle, redirects to login on success |
| `verify-email.html` | Auth | Link-based verification for password reset and device rebind. Hourglass icon during loading |
| `request-rebind.html` | Student | Device rebind request with phone icon, "once per semester" messaging, bottom nav |
| `student/dashboard.html` | Student | Enrolled courses with color-coded attendance %, Scan QR button, enrollment by 6-char code, bottom nav (Courses/Scan/Device/Exit), campus footer |
| `student/scan.html` | Student | Camera QR scanner (html5-qrcode), GPS status bar with animated dot, fingerprint fallback on failure, auto-retry after 3s on scan error |
| `instructor/dashboard.html` | Instructor | Course list with gold enrollment code badges, collapsible create form with Leaflet satellite map + location search + schedule day/time dropdowns, bottom nav, campus footer |
| `instructor/course.html` | Instructor | Course detail: enrollment code, geofence/window/refresh config display, student roster table with remove, session list with Start/Cancel/View QR buttons, add ad-hoc session. Error-checked API calls |
| `instructor/session.html` | Instructor | Live session: QR code frame (responsive clamp sizing), green "Live" badge, attendance counter, "End Session" button. Error state view. Closed state with final count + back button. Socket.IO for real-time QR refresh + HTTP polling fallback |

---

## Frontend — Assets (`src/frontend/assets/`)

| File | Purpose |
|---|---|
| `auk-logo.svg` | AUK logo (garnet #8D2222 + gold #D4A037) for auth pages — 140px display |
| `auk-logo-white.svg` | White + gold variant for dark nav bar backgrounds |
| `campus-bg.jpg` | AUK campus night photo — used as footer background with crimson overlay |

---

## Frontend — Styles (`src/frontend/styles/`)

| File | Purpose |
|---|---|
| `main.css` | Entire app CSS: AUK brand variables (--primary: #9a182b, --accent: #D4A037, --bg: #f4ecdb), auth page centered layout, cards (borderless, shadow, 14px radius, hover lift, staggered slideUp entrance), buttons (brightness hover, scale active), bottom nav bar, campus photo footer, loading states (button spinner, page loader bar, skeleton shimmer cards), responsive clamp typography, custom scrollbar, password toggle, mobile breakpoints |

---

## Tests

| File | Type | What it tests |
|---|---|---|
| `tests/integration/auth-flow.test.js` | Integration | Register → verify → login → lockout → reset. 10 tests covering all 13 Inc 1 acceptance criteria |
| `src/backend/services/session-generator.test.js` | Unit | Session generation: Mon/Wed schedule, past date range, invalid days, sort order. 4 tests |
| `src/backend/services/attendance-calculator.test.js` | Unit | % calculation: 0%, mixed, excused excluded from denominator, 100%. 4 tests |
| `src/backend/services/notification-service.test.js` | Unit | Threshold crossing: null pct, below threshold, above threshold. 3 tests |
| `src/backend/validators/qr-validator.test.js` | Unit | Token validation: current, expired, malformed. 3 tests |
| `src/backend/validators/device-checker.test.js` | Unit | Fingerprint: match, mismatch, not found. 3 tests |
| `src/backend/validators/ip-validator.test.js` | Unit | IP check: Kuwait pass, non-Kuwait, VPN, timeout FAIL-OPEN, private IP. 5 tests (mocked fetch) |
| `src/backend/validators/gps-accuracy-checker.test.js` | Unit | GPS: valid, >150m, ===0, null, boundary 150, boundary 150.01. 6 tests |
| `src/backend/validators/scan-verifier.test.js` | Unit | Pipeline: all 5 called on success, short-circuit at layers 1/2/5, exact call order [1,2,3,4,5,6]. 5 tests (all validators mocked via vi.mock) |

**Total: 43 tests across 9 files. All passing.**

---

## Scripts (`scripts/`)

| File | Purpose |
|---|---|
| `seed.js` | Creates test@auk.edu.kw (instructor) and student@auk.edu.kw (student) with pre-verified emails and bcrypt passwords. Run: `node scripts/seed.js` |
| `screenshot-all.js` | Playwright: logs in as both roles, takes 8 screenshots of all pages. Run: `node scripts/screenshot-all.js` |

---

## Migrations (`drizzle/`)

| File | Tables created |
|---|---|
| `0000_outstanding_psynapse.sql` | users, students, instructors, email_verification_tokens, courses, enrollments, sessions |
| `0001_sudden_scalphunter.sql` | qr_tokens, attendance, audit_log + append-only triggers |
| `0002_known_aqueduct.sql` | warning_email_log |
