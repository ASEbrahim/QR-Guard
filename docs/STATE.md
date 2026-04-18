<!--
last_updated: 2026-04-18
audience: Claude Code (read at the start of every session), maintainer (track progress)
role: the live state of the QR-Guard build — what's done, what's in progress, what's next
-->

# STATE.md

> The single source of truth for "where are we right now." Update this at the end of every session. Read it at the start of every session.

---

## Current sprint

**Active increment:** All 5 complete — feature-complete, audited, security-hardened, deployed
**Active sprint focus:** none — all implementation, auditing, and deployment work finished
**Last commit:** 58 commits across April 16-18, 2026
**Audit status:** 8 audit passes complete (77 findings, 65 fixed)
**Security audit:** 29 vulnerabilities found; all critical/high fixed
**UI redesign:** Complete — crimson + gold AUK branding, bottom nav, FAB, bottom sheets
**Deployment:** Live at https://qrguard.strat-os.net (Render + Neon, custom domain via Cloudflare CNAME)

---

## Increment status

| # | Increment | Status | Notes |
|---|---|---|---|
| 1 | Authentication & accounts | ✅ Complete | Sprint A, 2026-04-16 |
| 2 | Course management | ✅ Complete | Sprint A, 2026-04-16 |
| 3 | Dynamic QR & scan pipeline | ✅ Complete | Sprint B, 2026-04-16 |
| 4 | Reports & analytics | ✅ Complete | Sprint C, 2026-04-16 |
| 5 | Notifications, override, audit, hardening | ✅ Complete | Sprint C, 2026-04-16 |

**Status legend:** ⏳ Not started · 🛠 In progress · 🔍 In review · ✅ Complete · ⚠️ Blocked

---

## Open decisions

(Anything the maintainer needs to resolve before work can continue. Empty when no blockers.)

- _(none)_

---

## Deviations from plan

(Anything implemented differently from the FRS or class diagram. Each entry: what was deviated, why, and whether the FRS/diagram should be updated.)

- Added `semester_start` and `semester_end` to courses table (not in original SCHEMA.md) — needed for session auto-generation
- Stored geofence as WKT text string instead of native geography column — Drizzle ORM doesn't support PostGIS geography type natively. GeofenceChecker uses `ST_GeogFromText()` cast in raw SQL.
- `attendance.ip_address` stored as `text` not `inet` — SCHEMA.md says inet, but text avoids Drizzle type headaches. Functionally identical.
- Single-use enforcement is per (student, session) not per (student, session, refresh_window) — simpler, students who fail can ask instructor for override in Sprint C.

---

## Known issues / technical debt

(Things that work but aren't ideal. Each entry: what's wrong, why it was left, when to revisit.)

- _(none)_

---

## Next steps

1. Update FRS v1.1 to v2.0 (see `docs/DOCUMENT_UPDATE_INSTRUCTIONS.md` for exact changes)
2. Update PR2 document with final implementation metrics, audit results, and challenges
3. Update PPTX presentation slides (architecture, demo URL, audit results, color scheme)
4. Campus GPS test — verify geofence accuracy with real AUK coordinates
5. Demo rehearsal — cold start timing, test accounts, walkthrough flow

---

## Session log

(Brief one-line entry per session: date, what was done, where the next session should start.)

- 2026-04-16: Sprint A complete (Auth + Course Management). 14 tests pass, lint clean. Next: Sprint B.
- 2026-04-16: Sprint B complete (Dynamic QR + Scan Pipeline). 36 tests pass, lint clean. Next: Sprint C.
- 2026-04-16: Sprint C complete (Reports + Notifications + Hardening). 43 tests pass, lint clean. Feature-complete.
- 2026-04-17: 8 audit passes complete (code quality, schema, pipeline, readability, structure/BigO, frontend, memory/resources, deps/accessibility). 77 findings, 65 fixed. Security audit: 29 vulnerabilities found, all critical/high fixed (session fixation, CORS, open redirect, XSS, Socket.IO auth, IDOR, rate limiting). UI redesign ported from auk-qr-guard prototype. Deployed to Render + Neon.
- 2026-04-18: Custom domain configured: qrguard.strat-os.net via Cloudflare CNAME to qr-guard.onrender.com. Resend email domain: noreply@mail.strat-os.net. Final session report and document update instructions written. 56 total commits. Next: update FRS/PR2/PPTX, campus GPS test, demo rehearsal.
