# QR-Guard — Session Report (April 16–17, 2026)

## Overview

Single continuous session: designed, built, tested, deployed, and polished a full-stack attendance system from an empty GitHub repo to a live production app at **https://qr-guard.onrender.com**.

---

## What Was Built

### System Architecture
- **Backend**: Node.js + Express (ESM), 26 backend files
- **Frontend**: Vanilla HTML/CSS/JS, 12 pages + 3 shared scripts + 3 assets
- **Database**: PostgreSQL 16 + PostGIS on Neon (cloud, free tier)
- **Real-time**: Socket.IO for live QR refresh + attendance counter
- **Hosting**: Render (free tier, auto-deploy from GitHub)
- **Email**: Resend with custom domain `mail.strat-os.net`
- **Total**: 70 source files, ~5,600 lines of code

### Database Schema (12 tables)
| Table | Purpose |
|---|---|
| `users` | Base user accounts (email, password hash, role, lockout) |
| `students` | Student-specific: university ID, device fingerprint |
| `instructors` | Instructor-specific: employee ID |
| `email_verification_tokens` | Tokens for email verify, password reset, device rebind |
| `courses` | Course config: geofence, schedule, thresholds |
| `enrollments` | Student-course many-to-many with soft-delete |
| `sessions` | Class sessions (scheduled, active, closed, cancelled) |
| `qr_tokens` | Dynamic QR payloads with expiry timestamps |
| `attendance` | Attendance records with GPS, IP, device hash |
| `audit_log` | Append-only log (DB triggers reject UPDATE/DELETE) |
| `warning_email_log` | One-per-crossing threshold email tracking |
| `session` | Express session store (auto-created by connect-pg-simple) |

### API Endpoints (31 routes)

**Auth (9 routes):**
- `POST /api/auth/register` — student registration with @auk.edu.kw validation
- `POST /api/auth/login` — login with device fingerprint check
- `POST /api/auth/logout` — destroy session
- `POST /api/auth/verify-code` — 6-digit email verification code
- `POST /api/auth/resend-verification` — resend verification code
- `GET /api/auth/verify-email` — link-based verification (reset/rebind)
- `POST /api/auth/forgot-password` — request password reset
- `POST /api/auth/reset-password` — reset with token
- `POST /api/auth/request-rebind` — student requests device rebind
- `GET /api/auth/me` — current user profile

**Courses (10 routes):**
- `POST /api/courses` — create course with geofence + schedule
- `GET /api/courses` — list user's courses (role-aware)
- `GET /api/courses/:id` — course detail with sessions
- `PUT /api/courses/:id` — update config
- `POST /api/courses/enroll` — enroll by 6-char code only
- `POST /api/courses/:id/enroll` — enroll by code + course ID
- `DELETE /api/courses/:id/students/:studentId` — soft-remove
- `GET /api/courses/:id/students` — roster with attendance % + at-risk flags
- `POST /api/courses/:id/sessions` — add ad-hoc session
- `PATCH /api/courses/:id/sessions/:sessionId` — cancel session

**Scan Pipeline (4 routes):**
- `POST /api/sessions/:id/start` — start QR generation loop
- `POST /api/sessions/:id/stop` — stop session
- `GET /api/sessions/:id/qr` — HTTP polling fallback
- `POST /api/scan` — main scan endpoint (runs 6-layer pipeline)

**Reports (5 routes):**
- `GET /api/courses/:id/attendance` — per-session report
- `GET /api/courses/:id/attendance/student/:studentId` — per-student report
- `GET /api/courses/:id/attendance.csv` — CSV export with filters
- `GET /api/me/attendance` — student self-view
- `GET /api/courses/:id/audit-log` — paginated audit log

**Override (1 route):**
- `POST /api/sessions/:id/override` — change student status with reason

### 6-Layer Anti-Fraud Scan Pipeline
Executed in order (cheapest first, fail-fast, audit always runs):

| Layer | Validator | What It Checks | On Failure |
|---|---|---|---|
| 1 | `QrValidator` | Token valid for current refresh cycle | "QR expired — wait for refresh" |
| 2 | `DeviceChecker` | Fingerprint matches stored binding | "Device not recognized" |
| 3 | `IpValidator` | ip-api.com: country=Kuwait, no VPN (FAIL-OPEN) | "Location verification failed" |
| 4 | `GpsAccuracyChecker` | Accuracy ≤150m and ≠0 | "Location verification failed" |
| 5 | `GeofenceChecker` | PostGIS ST_DWithin via ST_GeogFromText + 15m margin | "Outside classroom area" |
| 6 | `AuditLogger` | Append every attempt to audit_log (finally block) | Never fails (catches internally) |

### Frontend Pages (12 pages)

**Auth pages (6):** login, register (with 6-digit code verification step), forgot-password, reset-password, verify-email, request-rebind

**Student pages (2):** dashboard (enrolled courses + enrollment form + Scan QR button), scan (camera + GPS + fingerprint)

**Instructor pages (3):** dashboard (course list + create with Leaflet geofence map + schedule builder), course detail (roster + sessions + start/cancel), live session (QR display + counter + stop)

**Landing (1):** index.html (auto-redirects by session state)

### Testing
- **43 automated tests** (Vitest)
  - 10 integration tests: auth flow (register → verify → login → lockout → reset)
  - 4 unit tests: session auto-generation from weekly schedule
  - 3 unit tests: QR token validation (current, expired, malformed)
  - 3 unit tests: device fingerprint (match, mismatch, not found)
  - 5 unit tests: IP validation (Kuwait, non-Kuwait, VPN, timeout FAIL-OPEN, private IP)
  - 6 unit tests: GPS accuracy (valid, >150m, ===0, null, boundary)
  - 5 unit tests: scan pipeline order enforcement via spies + short-circuit at each layer
  - 4 unit tests: attendance % calculation (0%, mixed, excused excluded, 100%)
  - 3 unit tests: notification threshold crossing logic
- **3 parallel validation audits** (code quality, schema consistency, pipeline order)
- **ESLint**: clean across all backend + test files
- **Fresh DB migration test**: all 3 migrations applied from scratch, verified

---

## Issues Found and Fixed

### Critical Bugs Fixed
| # | Issue | Where Found | Fix |
|---|---|---|---|
| 1 | `getCurrentToken` returned oldest QR token (ASC sort) instead of latest | Code review audit | Changed to `DESC` sort order |
| 2 | `notifyInstructorAukLimit` received undefined `student` — TypeError crash | Code review audit | Added `student &&` guard before call |
| 3 | `getQr` endpoint exposed any session's QR to any authenticated user | Code review audit | Added enrollment/ownership check |
| 4 | Login crashed with "expected string, received null" on `deviceFingerprint` | User testing | Changed Zod schema from `.optional()` to `.nullish()` |
| 5 | Rate limiter locked users out during development (5 attempts / 10 min) | User testing | Added `skip` in dev mode (`NODE_ENV !== 'production'`) |
| 6 | Email verification link pointed to `localhost:3000` in production | User testing | Switched to 6-digit verification code (no URL dependency) |
| 7 | FingerprintJS failure blocked scan entirely | User testing | Changed to proceed with fallback value instead of blocking |
| 8 | Express 5 wildcard route `*` syntax changed | Server startup crash | Updated to `/api/{*path}` pattern |

### Design Deviations Documented
| Deviation | Reason |
|---|---|
| `attendance.ip_address` stored as `text` not `inet` | Drizzle ORM type compatibility |
| `courses.geofence_center` stored as WKT `text` not `geography` | Drizzle doesn't support PostGIS geography natively; cast via `ST_GeogFromText()` in raw SQL |
| `semester_start` + `semester_end` added to courses table | Needed for session auto-generation; not in original SCHEMA.md |
| Single-use per (student, session) not per refresh_window | Simpler; students who fail can request instructor override |
| Hosting changed from Vercel+Railway to Render+Neon | Socket.IO requires persistent connections; Vercel is serverless |

### UI Issues Fixed
| Issue | Fix |
|---|---|
| OpenStreetMap tiles blocked on localhost (Referer policy) | Switched to CartoDB Voyager, then ESRI satellite |
| AUK logo invisible in nav bar (red on red) | Created white SVG variant for dark backgrounds |
| Password toggle emoji caused layout jumps across platforms | Replaced with plain "SHOW/HIDE" text |
| Session page was full-screen black with technical WebSocket text | Redesigned with normal page layout, clean QR frame, no technical text |
| "Session not found" showed green "Live" badge | Added proper error state view |
| Student enrollment required course UUID | Added `POST /api/courses/enroll` — lookup by 6-char code only |
| Weekly schedule required raw JSON input | Built dropdown selector with day/time pickers |
| Map tiles showed "Access blocked" | Switched to ESRI World Imagery (satellite) |
| Cards had generic left accent bar | Redesigned with borderless shadow cards, 14px radius |
| Hamburger menu was hidden and non-intuitive | Replaced with fixed bottom navigation bar |

---

## Deployment Infrastructure

| Component | Service | Tier | Region |
|---|---|---|---|
| Web server | Render | Free (750 hr/mo) | US East (Ohio) |
| Database | Neon (PostgreSQL 16 + PostGIS) | Free (0.5 GB) | US East 1 (Virginia) |
| Email | Resend + `mail.strat-os.net` domain | Free (100/day) | US East 1 |
| DNS | Cloudflare (for strat-os.net) | Free | — |
| Repository | GitHub (`ASEbrahim/QR-Guard`) | Free | — |

### Production Environment Variables
```
DATABASE_URL     → Neon connection string (SSL required)
NODE_ENV         → production
SESSION_SECRET   → auto-generated
EMAIL_PROVIDER   → resend
RESEND_API_KEY   → re_xxx
BASE_URL         → https://qr-guard.onrender.com
```

---

## Technology Stack

### Production Dependencies (17)
`bcrypt`, `connect-pg-simple`, `cors`, `csv-stringify`, `date-fns`, `date-fns-tz`, `dotenv`, `drizzle-orm`, `express`, `express-rate-limit`, `express-session`, `helmet`, `pg`, `qrcode`, `resend`, `socket.io`, `zod`

### Dev Dependencies (8)
`@eslint/js`, `@playwright/test`, `drizzle-kit`, `eslint`, `nodemon`, `prettier`, `supertest`, `vitest`

---

## UI/UX Design

### Color Scheme (AUK Brand)
| Variable | Value | Usage |
|---|---|---|
| `--primary` | `#9a182b` (dark crimson) | Nav, buttons, links, accents |
| `--accent` | `#D4A037` (gold) | Brand text, enrollment codes, highlights |
| `--bg` | `#f4ecdb` (warm cream) | Page background |
| `--surface` | `#ffffff` | Cards, forms |

### Key Design Decisions
- AUK logo (garnet + gold SVG) on all auth pages (140px) + nav bar (white variant, 32-44px)
- Bottom navigation bar (mobile-first) instead of hamburger menu
- Borderless cards with shadow lift on hover
- Staggered card entrance animations (slideUp with delay)
- Button brightness hover (1.1) + scale active (0.97) from StratOS interactivity patterns
- Custom garnet-tinted scrollbar
- Campus photo footer with crimson overlay
- 6-digit verification code instead of email link
- Styled HTML email templates with AUK branding

### Shared Component System
`components.js` provides: `renderNav()`, `renderNavWithBack()`, `renderBottomNav()`, `renderFooter()`, `doLogout()`, `loadUserName()` — all pages use these instead of inline HTML. Single file to edit for nav/footer changes.

---

## Commit History (30 commits, April 16–17)

| Phase | Commits | Key Deliverables |
|---|---|---|
| Repo setup | 2 | Docs, UML, sprint prompts, CLAUDE.md, .gitignore |
| Sprint A (Auth + Courses) | 2 | 7 DB tables, 17 API endpoints, 10 frontend pages, 14 tests |
| Sprint B (Scan Pipeline) | 2 | 3 DB tables, 6 validators, Socket.IO, QR scanning, 22 tests |
| Sprint C (Reports + Hardening) | 2 | Reports, CSV, notifications, override, rate limiting, 7 tests |
| Code review audit | 1 | 4 bugs fixed from 3-agent parallel audit |
| UI polish (batches 1-3) | 3 | Branding, centered auth, card polish, AUK colors, nav overhaul |
| Feature additions | 6 | Satellite map, schedule builder, enroll-by-code, verification code, resend email, loading states |
| Bug fixes | 5 | Fingerprint, rate limiter, password toggle, error handling, session layout |
| Deployment | 1 | Render + Neon config, SSL, 0.0.0.0 binding |
| Design iterations | 5 | Color changes (garnet → teal → crimson), bottom nav, animations, campus footer |
| Component consolidation | 1 | Shared components.js for all nav/footer/logout |

---

## What Remains

| Task | Priority | Estimated Effort |
|---|---|---|
| Campus GPS testing (real devices at AUK) | High | 1 session (2 hours) |
| Presentation slides | High | 1-2 hours |
| Update FRS to reflect Render+Neon, verification code, bottom nav | Medium | 30 min |
| Update PR2 with this session's implementation details | Medium | 30 min |
| Final Report (expand FRS into template) | Medium | 3-4 hours |
| Admin panel for instructor account creation | Low | 1-2 hours |
| Map rotation support (Leaflet plugin) | Low | 30 min |
