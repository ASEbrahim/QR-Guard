<!--
last_updated: 2026-04-16
audience: Claude Code (read at the start of every session), maintainer (track progress)
role: the live state of the QR-Guard build — what's done, what's in progress, what's next
-->

# STATE.md

> The single source of truth for "where are we right now." Update this at the end of every session. Read it at the start of every session.

---

## Current sprint

**Active increment:** All complete — feature-complete
**Active sprint focus:** none — ready for PR2
**Last commit:** feat(sprint-c): reports + notifications + override + hardening

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

1. Write Progress Report 2 document
2. Build presentation slides
3. Push all commits to GitHub
4. Deploy or set up local demo

---

## Session log

(Brief one-line entry per session: date, what was done, where the next session should start.)

- 2026-04-16: Sprint A complete (Auth + Course Management). 14 tests pass, lint clean. Next: Sprint B.
- 2026-04-16: Sprint B complete (Dynamic QR + Scan Pipeline). 36 tests pass, lint clean. Next: Sprint C.
- 2026-04-16: Sprint C complete (Reports + Notifications + Hardening). 43 tests pass, lint clean. Feature-complete.
