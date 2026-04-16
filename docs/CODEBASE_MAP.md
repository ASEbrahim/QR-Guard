<!--
last_updated: 2026-04-16
audience: Claude Code (locate files), maintainer (review structure)
role: a one-line description of every code file in the project
-->

# CODEBASE_MAP.md

> Every code file in the project, with a one-line description. Update this whenever you add, rename, or significantly repurpose a file. Lets Claude Code (and any new team member) understand the codebase without reading every file.

---

## Status

Sprint A (Auth + Courses) ✅ complete. Sprint B next.

---

## Files (alphabetical)

| File | Purpose |
|---|---|
| `src/backend/config/constants.js` | Named constants: bcrypt rounds, lockout duration, email regex, geofence limits |
| `src/backend/config/database.js` | Drizzle ORM connection via node-postgres Pool |
| `src/backend/controllers/auth-controller.js` | Register, login, verify email, reset password, device rebind logic |
| `src/backend/controllers/course-controller.js` | Course CRUD, enrollment, roster, session management |
| `src/backend/db/schema/course.schema.js` | Drizzle schema: courses table |
| `src/backend/db/schema/enrollment.schema.js` | Drizzle schema: enrollments (many-to-many) |
| `src/backend/db/schema/index.js` | Re-exports all schema tables |
| `src/backend/db/schema/session.schema.js` | Drizzle schema: sessions table |
| `src/backend/db/schema/token.schema.js` | Drizzle schema: email_verification_tokens |
| `src/backend/db/schema/user.schema.js` | Drizzle schema: users, students, instructors |
| `src/backend/middleware/auth-middleware.js` | requireAuth + requireRole middleware |
| `src/backend/routes/auth-routes.js` | Express router for /api/auth/* |
| `src/backend/routes/course-routes.js` | Express router for /api/courses/* |
| `src/backend/server.js` | Express app entry point, middleware setup, static serving |
| `src/backend/services/email-service.js` | Resend / SMTP / console email abstraction |
| `src/backend/services/enrollment-code.js` | 6-char enrollment code generator with collision retry |
| `src/backend/services/session-generator.js` | Auto-generate sessions from weekly schedule + date range |
| `src/frontend/forgot-password.html` | Forgot password form |
| `src/frontend/index.html` | Landing page — auto-redirects by session state |
| `src/frontend/instructor/course.html` | Course detail: roster, sessions, cancel/add |
| `src/frontend/instructor/dashboard.html` | Instructor dashboard: course list, create with Leaflet map |
| `src/frontend/login.html` | Login form with FingerprintJS integration |
| `src/frontend/register.html` | Registration form with role selector |
| `src/frontend/request-rebind.html` | Student device rebind request page |
| `src/frontend/reset-password.html` | Password reset form (token in URL) |
| `src/frontend/scripts/api.js` | Shared fetch wrapper with auth handling |
| `src/frontend/scripts/fingerprint.js` | FingerprintJS v4 open-source CDN integration |
| `src/frontend/student/dashboard.html` | Student dashboard: enrolled courses, enrollment form |
| `src/frontend/styles/main.css` | Shared CSS: mobile-first, clean, professional |
| `src/frontend/verify-email.html` | Email verification + device rebind landing page |
| `tests/integration/auth-flow.test.js` | Integration tests: registration, login, verification, lockout, reset |
| `src/backend/services/session-generator.test.js` | Unit tests: session generation from weekly schedule |

---

## Update template

When adding a file, add a row in this format:

```
| `src/backend/validators/geofence-checker.js` | Layer 5 of scan pipeline; PostGIS ST_DWithin against course geofence + 15m margin |
```

Sort alphabetically by full path within the table.
