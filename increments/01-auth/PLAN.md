# Sprint A — Foundation (Auth + Course Management)

**Spec source:** INCREMENTS.md § Inc 1 + Inc 2
**FRS sections:** FR1.1–FR1.8, FR2.1–FR2.8
**Dependencies:** none (this is the foundation)

---

## Scope confirmation

This sprint delivers the entire user-facing foundation: registration with @auk.edu.kw email validation, email verification, login with account lockout, device fingerprint binding via FingerprintJS, password reset, role-based dashboards, course creation with geofence configuration, student enrollment via 6-character codes, session auto-generation from weekly schedules, and instructor roster management with soft-delete. After this sprint, two users can register (one student, one instructor), the instructor can create a course with a geofence, the student can enroll, and both can see role-appropriate dashboards.

---

## Out of scope

- QR code generation and scanning (Sprint B)
- Attendance recording (Sprint B)
- Reports, CSV export (Sprint C)
- Warning emails, override, hardening (Sprint C)
- Bulk student import via CSV
- Multi-instructor courses
- OAuth/SSO, two-factor auth
- Course templates/cloning

---

## Architecture decisions

### Session management: server-side sessions
Using `express-session` + `connect-pg-simple` (sessions stored in PostgreSQL). Rationale:
- Simpler than JWT for a class project — no token refresh logic, no client-side token storage
- Easy to invalidate (delete session row)
- Session cookie is HttpOnly + Secure + SameSite=Lax
- Session table auto-created by connect-pg-simple

### Device binding interpretation (FRS FR1.7 ambiguity)
**Explicit design decision:** device fingerprint is captured on the student's **first successful login** after email verification. Subsequent logins from a different fingerprint are rejected with "Device not recognized." This is our interpretation — the FRS says "one browser fingerprint per student" and "Re-bind once/semester via verified email" but does not specify exactly when the fingerprint is captured. We chose first-login because:
- Registration happens before the student has confirmed their identity (email not verified yet)
- First login after verification is the earliest trusted moment
- The student is likely on their primary device at this point

### Email service abstraction
Three modes controlled by `EMAIL_PROVIDER` env var:
- `resend` — production, uses Resend API
- `smtp` — fallback, uses Nodemailer + SMTP
- `console` — development, prints the full verification/reset URL to the server console for one-click testing

### Account lockout (FR1.6 ambiguity)
**Explicit design decision:** locked for 30 minutes OR until email recovery (whichever is sooner). The FRS says "locked after 5 failed attempts" but doesn't specify unlock mechanism. Auto-unlock after 30 min prevents permanent lockout while still deterring brute force.

### Enrollment code generation
6 characters from alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (excludes 0/O, 1/I/L to avoid confusion). Generated via `crypto.randomBytes`, retry on DB unique constraint collision.

### Session auto-generation
Given `weekly_schedule` JSON (e.g., `[{day: "mon", start: "09:00", end: "10:15"}]`) and semester start/end dates (part of course creation form), generate all session rows. Timezone: Asia/Kuwait (UTC+3, no DST). Sessions in the past are not generated.

---

## Data model changes

All tables per `docs/SCHEMA.md`. Sprint A creates these 7 tables:

### users
| Column | Type | Constraints |
|---|---|---|
| user_id | uuid | PK, default uuid_generate_v4() |
| email | text | UNIQUE NOT NULL |
| password_hash | text | NOT NULL |
| name | text | NOT NULL |
| role | text | NOT NULL, CHECK ('student','instructor') |
| email_verified_at | timestamptz | NULL |
| created_at | timestamptz | NOT NULL, default now() |
| failed_login_count | integer | NOT NULL, default 0 |
| locked_until | timestamptz | NULL |

### students
| Column | Type | Constraints |
|---|---|---|
| user_id | uuid | PK, FK users(user_id) ON DELETE CASCADE |
| university_id | text | UNIQUE NOT NULL |
| device_fingerprint | text | NULL |
| device_bound_at | timestamptz | NULL |

### instructors
| Column | Type | Constraints |
|---|---|---|
| user_id | uuid | PK, FK users(user_id) ON DELETE CASCADE |
| employee_id | text | UNIQUE NOT NULL |

### email_verification_tokens
| Column | Type | Constraints |
|---|---|---|
| token | text | PK |
| user_id | uuid | NOT NULL, FK users(user_id) ON DELETE CASCADE |
| purpose | text | NOT NULL, CHECK ('email_verify','password_reset','device_rebind') |
| expires_at | timestamptz | NOT NULL |
| used_at | timestamptz | NULL |

### courses
| Column | Type | Constraints |
|---|---|---|
| course_id | uuid | PK, default uuid_generate_v4() |
| instructor_id | uuid | NOT NULL, FK instructors(user_id) |
| name | text | NOT NULL |
| code | text | NOT NULL |
| section | text | NOT NULL |
| semester | text | NOT NULL |
| enrollment_code | text | UNIQUE NOT NULL |
| geofence_center | geography(Point,4326) | NOT NULL |
| geofence_radius_m | integer | NOT NULL, CHECK 10–500 |
| attendance_window_seconds | integer | NOT NULL, default 300 |
| warning_threshold_pct | numeric(5,2) | NOT NULL, default 85.00 |
| qr_refresh_interval_seconds | integer | NOT NULL, default 25 |
| weekly_schedule | jsonb | NOT NULL |
| semester_start | date | NOT NULL |
| semester_end | date | NOT NULL |
| created_at | timestamptz | NOT NULL, default now() |

**Note:** `semester_start` and `semester_end` are additions to SCHEMA.md — needed for session auto-generation. Will update SCHEMA.md after implementation.

### enrollments
| Column | Type | Constraints |
|---|---|---|
| course_id | uuid | FK courses(course_id) ON DELETE CASCADE |
| student_id | uuid | FK students(user_id) ON DELETE CASCADE |
| enrolled_at | timestamptz | NOT NULL, default now() |
| removed_at | timestamptz | NULL |

PK: (course_id, student_id)

### sessions
| Column | Type | Constraints |
|---|---|---|
| session_id | uuid | PK, default uuid_generate_v4() |
| course_id | uuid | NOT NULL, FK courses(course_id) ON DELETE CASCADE |
| scheduled_start | timestamptz | NOT NULL |
| scheduled_end | timestamptz | NOT NULL |
| actual_start | timestamptz | NULL |
| actual_end | timestamptz | NULL |
| status | text | NOT NULL, default 'scheduled', CHECK ('scheduled','active','closed','cancelled') |
| created_at | timestamptz | NOT NULL, default now() |

Index: `sessions(course_id, scheduled_start)`

---

## API surface

### Auth routes — `src/backend/routes/auth-routes.js`

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| POST | `/api/auth/register` | `{email, password, name, role, universityId?, employeeId?}` | 201 `{userId}` | 400 validation, 409 email taken |
| POST | `/api/auth/login` | `{email, password, deviceFingerprint?}` | 200 `{user, redirectUrl}` | 400, 401 wrong creds, 403 not verified, 403 device mismatch, 429 locked |
| POST | `/api/auth/logout` | — | 200 | 401 |
| GET | `/api/auth/verify-email` | query: `token` | 200 `{message}` | 400 invalid/expired |
| POST | `/api/auth/forgot-password` | `{email}` | 200 (always, no email leak) | — |
| POST | `/api/auth/reset-password` | `{token, newPassword}` | 200 | 400 invalid/expired |
| POST | `/api/auth/request-rebind` | — (uses session) | 200 | 401, 403 not student |
| GET | `/api/auth/verify-rebind` | query: `token` | 200 clears fingerprint | 400 invalid/expired |
| GET | `/api/auth/me` | — | 200 `{user}` | 401 |

### Course routes — `src/backend/routes/course-routes.js`

| Method | Path | Body | Success | Errors |
|---|---|---|---|---|
| POST | `/api/courses` | `{name, code, section, semester, semesterStart, semesterEnd, weeklySchedule, geofenceLat, geofenceLng, geofenceRadius, attendanceWindow?, warningThreshold?, qrRefreshInterval?}` | 201 `{course}` | 400, 401, 403 not instructor |
| GET | `/api/courses` | — | 200 `[courses]` | 401 |
| GET | `/api/courses/:id` | — | 200 `{course}` | 401, 403, 404 |
| PUT | `/api/courses/:id` | partial update fields | 200 `{course}` | 400, 401, 403, 404 |
| POST | `/api/courses/:id/enroll` | `{enrollmentCode}` | 200 `{enrollment}` | 400, 401, 403 not student, 404, 409 already enrolled |
| DELETE | `/api/courses/:id/students/:studentId` | — | 200 | 401, 403, 404 |
| GET | `/api/courses/:id/students` | — | 200 `[{student, attendancePct}]` | 401, 403 |
| POST | `/api/courses/:id/sessions` | `{scheduledStart, scheduledEnd}` | 201 `{session}` | 400, 401, 403 |
| PATCH | `/api/courses/:id/sessions/:sessionId` | `{status: 'cancelled'}` | 200 | 400, 401, 403, 404 |

---

## File-level plan

### Project config (new)
```
package.json                          (new) project config, scripts, deps
.eslintrc.json                        (new) ESLint config
.prettierrc                           (new) Prettier config
drizzle.config.js                     (new) Drizzle Kit config
src/backend/config/constants.js       (new) named constants (BCRYPT_ROUNDS, LOCKOUT_DURATION_MS, etc.)
src/backend/config/database.js        (new) Drizzle DB connection
src/backend/server.js                 (new) Express app setup, middleware, route mounting
```

### Database schema (new)
```
src/backend/db/schema/user.schema.js           (new) users + students + instructors
src/backend/db/schema/token.schema.js          (new) email_verification_tokens
src/backend/db/schema/course.schema.js         (new) courses
src/backend/db/schema/enrollment.schema.js     (new) enrollments
src/backend/db/schema/session.schema.js        (new) sessions
src/backend/db/schema/index.js                 (new) re-exports all schemas
```

### Auth (new)
```
src/backend/routes/auth-routes.js              (new) Express router for /api/auth/*
src/backend/controllers/auth-controller.js     (new) register, login, verify, reset, rebind logic
src/backend/services/email-service.js          (new) Resend / SMTP / console abstraction
src/backend/middleware/auth-middleware.js       (new) requireAuth, requireRole('student'|'instructor')
```

### Courses (new)
```
src/backend/routes/course-routes.js            (new) Express router for /api/courses/*
src/backend/controllers/course-controller.js   (new) CRUD, enrollment, session management
src/backend/services/enrollment-code.js        (new) 6-char code generation with collision retry
src/backend/services/session-generator.js      (new) auto-generate sessions from weekly schedule
```

### Frontend (new) — 10 pages
```
src/frontend/index.html                        (new) landing/redirect
src/frontend/register.html                     (new) registration form (role selector)
src/frontend/login.html                        (new) login form
src/frontend/verify-email.html                 (new) "click your email link" landing
src/frontend/forgot-password.html              (new) enter email
src/frontend/reset-password.html               (new) enter new password (token in URL)
src/frontend/request-rebind.html               (new) student requests device rebind
src/frontend/student/dashboard.html            (new) enrolled courses, attendance %
src/frontend/instructor/dashboard.html         (new) courses list, create course
src/frontend/instructor/course.html            (new) course detail, roster, sessions, geofence map
src/frontend/styles/main.css                   (new) shared styles
src/frontend/scripts/api.js                    (new) shared fetch wrapper with auth
src/frontend/scripts/fingerprint.js            (new) FingerprintJS integration
```

### Tests (new)
```
src/backend/controllers/auth-controller.test.js    (new) unit tests
src/backend/controllers/course-controller.test.js  (new) unit tests
src/backend/services/enrollment-code.test.js       (new) unit tests
src/backend/services/session-generator.test.js     (new) unit tests
tests/integration/auth-flow.test.js                (new) register → verify → login → dashboard
tests/integration/course-flow.test.js              (new) create → enroll → roster → sessions
```

### Doc updates
```
docs/STATE.md                          (modify) mark Sprint A status
docs/CODEBASE_MAP.md                   (modify) add all new files
docs/SCHEMA.md                         (modify) add semester_start, semester_end to courses
```

**Total: ~30 new files**

---

## Test plan

Mapped to acceptance criteria from INCREMENTS.md:

### Inc 1 acceptance criteria
| # | Criterion | Test |
|---|---|---|
| 1 | Student registers with @auk.edu.kw, gets verification email | integration: register with valid email → 201, console shows token URL |
| 2 | Non-AUK email rejected | unit: register with gmail.com → 400 |
| 3 | Login fails before verification | integration: register → login without verify → 403 |
| 4 | After verification, login succeeds + redirects to student dashboard | integration: register → verify → login → 200 with redirectUrl |
| 5 | Instructor registers + redirects to instructor dashboard | integration: register instructor → verify → login → instructor redirect |
| 6 | First login captures device fingerprint | integration: login with fingerprint → check DB has fingerprint stored |
| 7 | Second login from different fingerprint rejected | integration: login with fp_A → logout → login with fp_B → 403 device mismatch |
| 8 | Instructor can re-bind student device via email | integration: request-rebind → verify-rebind → fingerprint cleared → login with new fp works |
| 9 | 5 failed logins lock account, email recovery works | unit: 5 failed attempts → locked_until set. integration: locked → 429 → reset password → login works |
| 10 | Password reset email + token expiry | integration: forgot-password → token in console → reset → login with new password |
| 11 | Passwords are bcrypt hashes | unit: check stored hash starts with $2b$ |
| 12 | Unauthenticated routes return 401 | integration: GET /api/courses without session → 401 |
| 13 | Student can't access instructor routes, vice versa | integration: student → GET instructor-only route → 403 |

### Inc 2 acceptance criteria
| # | Criterion | Test |
|---|---|---|
| 1 | Instructor creates course with unique enrollment code | integration: POST /api/courses → 201, code is 6 chars |
| 2 | No duplicate enrollment codes | unit: enrollment-code generator retry logic |
| 3 | Student enrolls via valid code | integration: POST /api/courses/:id/enroll → 200 |
| 4 | Duplicate enrollment rejected | integration: enroll twice → 409 |
| 5 | Geofence config (lat, lng, radius) + map preview | integration: PUT course with geofence → 200, radius in range |
| 6 | Radius 10-500m, out-of-range rejected | unit: radius 5 → 400, radius 600 → 400 |
| 7 | Per-course config (window, threshold, refresh interval) | integration: PUT course → verify config stored |
| 8 | Remove student, historical records retained | integration: DELETE student → removed_at set, past data queryable |
| 9 | Auto-generated sessions from weekly schedule | unit: session-generator with Mon/Wed schedule → correct dates |
| 10 | Cancel auto-session / add ad-hoc session | integration: PATCH cancel → 'cancelled', POST ad-hoc → 201 |

---

## Open questions (resolved)

| Question | Decision | Rationale |
|---|---|---|
| When is device fingerprint captured? | First login after email verification | Earliest trusted moment; pre-verification identity isn't confirmed |
| Lockout: permanent or auto-unlock? | 30-min auto-unlock OR email recovery | Prevents permanent lockout while deterring brute force |
| Dev email: how? | Console.log with full clickable URL | One-click testing, zero external dependency |
| Semester date range for session gen? | Instructor enters semester_start + semester_end in course creation | FRS doesn't specify; simplest approach |
| Removed student visibility? | Course disappears from student dashboard | `removed_at IS NULL` filter on student queries; historical data queryable by instructor |
| Enrollment code regeneratable? | Yes, PUT /api/courses/:id can regenerate | Covers leaked-code scenario |

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| PostGIS geography type not supported by Drizzle | Low | High | Drizzle supports custom SQL types via `sql` helper; worst case, store lat/lng as separate numeric columns and use raw SQL for ST_DWithin |
| FingerprintJS open-source has low accuracy | Medium | Medium | Acceptable for class project; note in known limitations. The CDN version is free and sufficient. |
| Session auto-generation creates too many rows | Low | Low | Typical semester: 15 weeks × 2-3 sessions/week = 30-45 rows per course. Trivial. |
| connect-pg-simple session table conflicts | Low | Low | It creates its own `session` table (singular). Our table is `sessions` (plural). No conflict. |

---

## Checkpoint commit strategy

1. **Commit 1:** `chore(sprint-a): project init — package.json, config, ESLint, Prettier, Drizzle`
   - Just tooling and config. No business logic. Safe rollback point.
2. **Commit 2:** `feat(sprint-a): auth + course management — full implementation`
   - All code, tests, frontend, doc updates.
3. **Fresh DB migration test** after Commit 2:
   - Drop qrguard DB, recreate, run `npm run db:push`, verify all tables exist.

---

## Acceptance criteria check

### Inc 1
- [ ] AC 1: Student registers with @auk.edu.kw + verification email
- [ ] AC 2: Non-AUK email rejected
- [ ] AC 3: Login fails before verification
- [ ] AC 4: Verified login succeeds + student dashboard redirect
- [ ] AC 5: Instructor registers + instructor dashboard
- [ ] AC 6: First login captures device fingerprint
- [ ] AC 7: Different fingerprint rejected
- [ ] AC 8: Instructor re-binds student device via email
- [ ] AC 9: 5 failed logins → lockout → email recovery
- [ ] AC 10: Password reset flow works
- [ ] AC 11: Passwords stored as bcrypt hashes
- [ ] AC 12: Unauthenticated → 401
- [ ] AC 13: Wrong role → 403

### Inc 2
- [ ] AC 1: Course created with unique 6-char enrollment code
- [ ] AC 2: No duplicate enrollment codes
- [ ] AC 3: Student enrolls via code
- [ ] AC 4: Duplicate enrollment → 409
- [ ] AC 5: Geofence config with map preview
- [ ] AC 6: Radius 10-500m enforced
- [ ] AC 7: Per-course config (window, threshold, refresh)
- [ ] AC 8: Remove student, history retained
- [ ] AC 9: Sessions auto-generated from schedule
- [ ] AC 10: Cancel / add ad-hoc session
