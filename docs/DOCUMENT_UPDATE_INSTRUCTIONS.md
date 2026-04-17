# Document Update Instructions

> Give this file to a fresh Claude session along with the current FRS, PR2, and PPTX files.
> It contains every change that needs to be reflected in those documents.

---

## Source of Truth

- **Session Report:** `docs/SESSION_REPORT.md` — full build log with all stats
- **Codebase Map:** `docs/CODEBASE_MAP.md` — every file documented
- **Live site:** https://qr-guard.onrender.com
- **Repo:** https://github.com/ASEbrahim/QR-Guard

---

## FRS v1.1 → v2.0 Changes

### Section 1: Product Overview
- **Hosting changed:** was "Vercel (frontend) + Railway (backend) + Neon (DB)" → now "Render (full-stack, free 750hr/mo) + Neon (PostgreSQL + PostGIS, free permanent tier)"
- **Budget:** still $0 — but hosting stack is different
- **Email:** was "Resend free tier" → now "Resend with custom domain mail.strat-os.net, sends from noreply@mail.strat-os.net"
- **Why Render instead of Vercel:** Socket.IO requires persistent WebSocket connections. Vercel is serverless and doesn't support them. Render runs a long-lived Node.js process.

### Section 2: Process Model
- **5 increments consolidated into 3 sprints** for build efficiency (Inc 1+2 = Sprint A, Inc 3 = Sprint B, Inc 4+5 = Sprint C). All 55 acceptance criteria still apply.

### Section 3: Functional Requirements

**FR1 (Auth) updates:**
- Registration is **student-only** now. Instructors are provisioned via seed script / admin. Remove the role selector from FR1.1.
- Email verification uses a **6-digit numeric code** entered on the registration page, NOT a clickable link. The student never leaves the site.
- Add: `POST /api/auth/verify-code` — validates 6-digit code against email
- Add: `POST /api/auth/resend-verification` — resends the 6-digit code
- Device fingerprint failure no longer blocks scan — proceeds with fallback value. Student still gets rejected if fingerprint doesn't match stored binding, but FingerprintJS CDN failure doesn't block the flow.

**FR2 (Courses) updates:**
- `semester_start` and `semester_end` added to courses table — needed for session auto-generation. Not in original FRS.
- Enrollment works with **6-char code only** (no course UUID needed). New endpoint: `POST /api/courses/enroll`
- Weekly schedule input is now **day/time dropdowns** (not JSON textarea). Times include :45 and :50 intervals for AUK class end times.
- Geofence map uses **ESRI satellite imagery** with street/satellite toggle and **Nominatim location search**.

**FR4 (Scan Pipeline) updates:**
- Pipeline order unchanged: QR → Device → IP → GPS Accuracy → Geofence → Audit
- Geofence check uses `ST_GeogFromText(geofence_center)` to cast the WKT text column (Drizzle doesn't support native PostGIS geography type)
- `attendance.ip_address` stored as `text` not `inet` (Drizzle type compatibility)
- Single-use is per (student, session), NOT per (student, session, refresh_window). Simpler — students who fail can ask instructor for override.
- GeofenceChecker returns distinct error code `course_not_found` (was incorrectly returning `outside_geofence` for missing courses)

### Section 5: Technology Stack Table
Update the entire table:

| Layer | Technology | Cost |
|---|---|---|
| Frontend | Vanilla HTML, CSS, JS. Mobile-first responsive. | $0 |
| Backend | Node.js 22 + Express 5. WebSocket via Socket.IO. | $0 |
| Database | PostgreSQL 16 + PostGIS (Neon free tier, US East 1). | $0 |
| ORM | Drizzle ORM | $0 |
| QR Generation | External API (api.qrserver.com) for display. Base64 payloads from server. | $0 |
| Device Fingerprint | FingerprintJS open-source v4 (CDN). | $0 |
| IP Intelligence | ip-api.com (free, no API key, 45 req/min). FAIL-OPEN. | $0 |
| Email | Resend + custom domain mail.strat-os.net (100 emails/day). | $0 |
| Hosting | Render (web service, free 750hr/mo, US East Ohio). | $0 |
| Real-time | Socket.IO (WebSocket + HTTP polling fallback) | $0 |
| Validation | Zod (runtime schema validation on all API inputs) | $0 |
| Testing | Vitest (43 tests) + Playwright (screenshots) | $0 |

### Section 6: Anti-Fraud Pipeline Table
No changes to the 6 layers. But add note: "ip-api.com uses FAIL-OPEN policy — if the API times out or returns an error, the scan proceeds and the skip is logged to the audit log."

### Section 7: NFRs
- Add: "QR token cleanup runs every 10 minutes (expired tokens deleted after 1 hour)"
- Add: "Orphaned active sessions are auto-closed on server restart"
- Add: "Request body size limited to 10kb via express.json()"
- Add: "Rate limiting skipped in development mode for testing convenience"

### Section 8: RTM
- Add traceability for new endpoints: verify-code, resend-verification, enroll-by-code
- Update deployment references: Render + Neon

### Section 9: V&V
- Tests: 43 passing (was 14 at PR1 time)
- 6 audit passes completed: code quality, schema consistency, pipeline order, readability, structure/BigO, memory/resources, dependencies, accessibility
- 77 findings across all audits, 56 fixed, 21 documented/acceptable

---

## PR2 Updates

### Section 3.4: Implementation
Update all sprint tables with final metrics:

**Sprint A (Auth + Courses):**
- Files: 30+ (17 backend + 10 frontend + config + tests)
- DB tables: 7
- API endpoints: 17 → now 19 (added verify-code, resend-verification, enroll-by-code)
- Tests: 14

**Sprint B (Scan Pipeline):**
- Files: 22
- DB tables added: 3 (qr_tokens, attendance, audit_log with append-only triggers)
- Tests: 22 new (36 total)

**Sprint C (Reports + Hardening):**
- Files: 20
- DB tables added: 1 (warning_email_log)
- Tests: 7 new (43 total)

**Post-Sprint:**
- 6 audit passes, 56 fixes applied
- 3 unused dependencies removed (qrcode, date-fns-tz, nodemon)
- Deployed to Render + Neon
- Real email via Resend + mail.strat-os.net custom domain
- AUK branding: garnet #9a182b + gold #D4A037, campus photo nav background

### Section 3.5: V&V
Update test table:

| Sprint | Tests Added | Cumulative | Key Tests |
|---|---|---|---|
| A | 14 | 14 | Registration, login lockout, device binding, enrollment, session auto-gen |
| B | 22 | 36 | 6 validator units, pipeline order spies, end-to-end scan |
| C | 7 | 43 | Report accuracy, CSV export, threshold crossing, override + audit |

Add audit results:

| Audit Pass | Findings | Fixed |
|---|---|---|
| Code quality (3 agents) | 6 | 4 fixed, 2 acknowledged |
| Schema consistency | 6 | 6 |
| Readability | 12 | 10 |
| Structure + Big O | 12 | 10 |
| Frontend clarity | 15 | 13 |
| Memory + resources | 9 | 7 |
| Dependencies | 7 | 3 removed, 4 documented |
| Accessibility | 8 | 3 fixed |
| **Total** | **77** | **56 fixed** |

### Section 4: Report/Presentation Progress
- FRS needs update to v2.0 (this document describes what to change)
- Session report created: `docs/SESSION_REPORT.md`
- Codebase map fully updated: `docs/CODEBASE_MAP.md`
- All design documents current

### Section 5: Challenges
Add new challenges:

| Challenge | Resolution |
|---|---|
| Drizzle ORM doesn't support PostGIS geography type | Stored geofence as WKT text, cast via ST_GeogFromText() in raw SQL |
| Vercel doesn't support WebSocket (Socket.IO) | Switched to Render which runs long-lived Node.js processes |
| Rate limiter blocked development testing | Added skip in dev mode (NODE_ENV !== 'production') |
| FingerprintJS CDN fails in some browsers | Scan proceeds with fallback value instead of blocking |
| QR token table grows infinitely | Added periodic cleanup (DELETE expired tokens every 10 min) |
| Server restart orphans active sessions | Auto-close on startup |
| N+1 queries in reports | Fixed with bulk inArray() fetch |
| XSS risks in innerHTML with user data | Added esc() helper, applied to all user-sourced insertions |

### Section 6: Plan Forward
Update milestones — implementation is COMPLETE. Remaining:

| Task | Status |
|---|---|
| Campus GPS testing | Planned |
| FRS v2.0 update | This document |
| Final Report | Template identified, most content exists |
| Presentation slides | Content ready from PR2 |
| Demo rehearsal | Planned |

---

## PPTX Updates

### Slide: Technology Stack
- Replace Vercel + Railway with Render + Neon
- Add Resend + mail.strat-os.net

### Slide: Implementation Progress
- All 5 increments: ✅ Complete
- 70 files, ~5,600 lines of code
- 43 automated tests
- Deployed and live at https://qr-guard.onrender.com

### Slide: Anti-Fraud Pipeline
- No changes to the 6 layers
- Add: "FAIL-OPEN on ip-api.com timeout"

### Slide: Testing / V&V
- Add audit results table (77 findings, 56 fixed)
- Add: "6 parallel audit passes covering code quality, Big O, XSS, accessibility, memory leaks, dependency health"

### Slide: Challenges
- Add the new challenges from the PR2 section above

### Slide: Architecture
- Update diagram labels if they reference Vercel/Railway → Render/Neon

### Slide: Demo
- Live URL: https://qr-guard.onrender.com
- Test accounts: test@auk.edu.kw / password123 (instructor), student@auk.edu.kw / password123 (student)
- Note: Render free tier has ~50s cold start on first load after inactivity

---

## Files Changed Since Original Documents

Total commits since PR2 was written: 20+

Key additions not in original PR2:
- `src/frontend/scripts/components.js` — shared nav/footer/logout (single file for all UI chrome)
- `src/frontend/assets/auk-logo.svg`, `auk-logo-white.svg`, `campus-bg.jpg` — AUK branding assets
- `scripts/seed.js` — test account seeder
- `scripts/screenshot-all.js`, `scripts/screenshot-mobile.js` — Playwright screenshot automation
- `render.yaml` — Render deployment config
- `docs/SESSION_REPORT.md` — comprehensive build session log
- `docs/DOCUMENT_UPDATE_INSTRUCTIONS.md` — this file

Dependencies removed: `qrcode` (unused), `date-fns-tz` (unused), `nodemon` (unused — dev uses node --watch)

---

## Color Scheme (for any visual updates in slides)

| Variable | Hex | Usage |
|---|---|---|
| --primary | #9a182b | Nav background, buttons, links, accents |
| --accent | #D4A037 | Brand text, enrollment codes, gold highlights |
| --bg | #f4ecdb | Page background (warm cream) |
| --surface | #ffffff | Cards, forms |
| --danger | #dc2626 | Error states, destructive actions |
| --success | #16a34a | Success states, GPS locked indicator |
