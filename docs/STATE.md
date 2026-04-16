<!--
last_updated: 2026-04-16
audience: Claude Code (read at the start of every session), maintainer (track progress)
role: the live state of the QR-Guard build — what's done, what's in progress, what's next
-->

# STATE.md

> The single source of truth for "where are we right now." Update this at the end of every session. Read it at the start of every session.

---

## Current sprint

**Active increment:** Sprint A (Inc 1 + Inc 2) ✅ Complete
**Active sprint focus:** Sprint B (Inc 3) — next
**Last commit:** feat(sprint-a): auth + course management

---

## Increment status

| # | Increment | Status | Notes |
|---|---|---|---|
| 1 | Authentication & accounts | ✅ Complete | Sprint A, 2026-04-16 |
| 2 | Course management | ✅ Complete | Sprint A, 2026-04-16 |
| 3 | Dynamic QR & scan pipeline | ⏳ Not started | Sprint B |
| 4 | Reports & analytics | ⏳ Not started | Sprint C |
| 5 | Notifications, override, audit, hardening | ⏳ Not started | Sprint C |

**Status legend:** ⏳ Not started · 🛠 In progress · 🔍 In review · ✅ Complete · ⚠️ Blocked

---

## Open decisions

(Anything the maintainer needs to resolve before work can continue. Empty when no blockers.)

- _(none)_

---

## Deviations from plan

(Anything implemented differently from the FRS or class diagram. Each entry: what was deviated, why, and whether the FRS/diagram should be updated.)

- Added `semester_start` and `semester_end` to courses table (not in original SCHEMA.md) — needed for session auto-generation
- Stored geofence as WKT text string instead of native geography column — Drizzle ORM doesn't support PostGIS geography type natively. Raw SQL used for ST_DWithin queries in Sprint B.

---

## Known issues / technical debt

(Things that work but aren't ideal. Each entry: what's wrong, why it was left, when to revisit.)

- _(none)_

---

## Next steps

1. Sprint B plan: Dynamic QR & scan pipeline (FR3-FR4)
2. Implement the 6-layer verification pipeline
3. Socket.IO for real-time QR refresh
4. Student scan UI with camera + GPS

---

## Session log

(Brief one-line entry per session: date, what was done, where the next session should start.)

- 2026-04-16: Sprint A complete (Auth + Course Management). 14 tests pass, lint clean. Next: Sprint B.
