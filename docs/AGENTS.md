<!--
last_updated: 2026-04-16
verified_against: FRS v1.1
audience: Claude Code (always reads this first), maintainer (reference)
role: rules of engagement for any code-modifying session
-->

# AGENTS.md

> Rules of engagement for Claude Code working on QR-Guard. **Read this first, every session.** This document is the contract — every other doc, prompt, and workflow assumes you have read this.

---

## Project context

QR-Guard is a location-based QR attendance system for the American University of Kuwait. CSIS 330 — Software Engineering, Dr. Aaron Rababaah. 6-person team, 14-week semester, $0 budget.

The full requirements live in `docs/FRS.docx` (v1.1). The design is in `docs/uml/` (9 diagrams). The project plan is in `docs/INCREMENTS.md` (5 increments). The data model is in `docs/SCHEMA.md`. Glossary is in `docs/GLOSSARY.md`. Current state is in `docs/STATE.md`.

You will be asked to implement features one increment at a time. Increments are defined in `docs/INCREMENTS.md`. Each increment has acceptance criteria. An increment is not complete until every criterion passes.

---

## The five non-negotiable rules

### Rule 1 — Plan first, code second

Every increment follows this flow:

1. Maintainer points you at an increment (e.g., "Start Inc 1")
2. You read `docs/AGENTS.md`, `docs/GLOSSARY.md`, `docs/SCHEMA.md`, `docs/INCREMENTS.md § <inc>`, and the relevant FRS sections + UML diagrams
3. You produce a plan in `increments/<NN>-<name>/PLAN.md` following the template in `docs/PROMPT_TEMPLATES.md`
4. **You wait for plan approval before writing any code**
5. Maintainer responds with notes. If they say **"address all notes, don't implement yet"** — you iterate on the plan only, no code
6. Maintainer approves with **"Plan approved. Implement."** — only then do you write code
7. After implementation: update `docs/STATE.md` and `docs/CODEBASE_MAP.md`

**No code before plan approval. Ever.** Even if the request seems trivial.

### Rule 2 — The FRS and UML are the spec

If your implementation doesn't match the FRS or the UML diagrams, the implementation is wrong. Not the spec. If you think the spec is wrong, **stop and flag it** — don't silently deviate.

The diagrams in `docs/uml/` are authoritative for:
- Data model → `04-class-diagram` (also see `SCHEMA.md`)
- Scan pipeline order → `02-sequence-scan` and `03-activity-verification`
- System architecture → `08-architecture`
- Process flows → `02-sequence-scan`, `06-session-state-machine`, `05-qr-state-machine`

### Rule 3 — Code must be readable by humans, not just runnable

Every file you write will be read by a 6-person student team and a professor. Optimize for clarity over cleverness. Specifics:

- **One class per file.** Filename = class name in kebab-case. `ScanVerifier` → `scan-verifier.js`.
- **JSDoc on every exported function.** Description, `@param` for each parameter, `@returns`. Example:
  ```js
  /**
   * Validates that a student's GPS coordinates fall within the course geofence.
   * Uses PostGIS ST_DWithin with a +15m indoor margin.
   * @param {{lat: number, lng: number, accuracy: number}} gps
   * @param {{centerLat: number, centerLng: number, radius: number}} geofence
   * @returns {Promise<boolean>} true if within geofence + margin
   */
  ```
- **No magic numbers.** Constants get named at the top of the file or in `src/config/constants.js`.
- **Descriptive names.** `verifyDeviceFingerprint(student, providedHash)` — not `check(s, h)`.
- **Single responsibility per function.** If you can't describe what a function does in one sentence, split it.
- **No silent failures.** Catch errors at the right layer, log them, return a meaningful response. Never swallow an exception.
- **Comments explain WHY, not WHAT.** The code shows what it does. Comments explain why a non-obvious decision was made.

### Rule 4 — Write the test as you write the code

Every public function in the verification pipeline (`ScanVerifier`, `IpValidator`, `GeofenceChecker`, `DeviceChecker`, `QrValidator`, `GpsAccuracyChecker`) gets a Vitest unit test with at minimum:
- Happy path
- One failure path
- One boundary case (where applicable)

Test files live alongside source: `scan-verifier.js` → `scan-verifier.test.js`.

For routes: at least one integration test per endpoint with a test database.

If you can't write a test for something, that's a sign the code is wrong. Refactor until it's testable.

### Rule 5 — Update the docs, every time

After every implementation:

1. **`docs/STATE.md`** → mark the increment as complete, list what was built, note any deviations from the plan
2. **`docs/CODEBASE_MAP.md`** → add new files to the map with a one-line description
3. **`docs/SCHEMA.md`** → if the database changed, update the schema doc
4. **`docs/GLOSSARY.md`** → if you introduced a new term, add it here

If you skip doc updates, the next session starts with stale context and produces inconsistent code.

---

## The stack (decided)

Don't change these without an explicit override from the maintainer.

| Layer | Tech |
|---|---|
| Backend | Node.js (LTS) + Express |
| Database | PostgreSQL + PostGIS (Neon free tier in production, local Postgres for dev) |
| ORM | Drizzle ORM (TypeScript schema, lightweight, native PostGIS support) |
| Real-time | Socket.IO (WebSocket with auto-fallback to HTTP polling) |
| Frontend | Vanilla HTML / CSS / JS (mobile-first, no framework) — per FRS |
| QR generation | qrcode.js (client-side display), Base64 payloads from server |
| Camera | Browser MediaDevices API |
| GPS | Browser Geolocation API |
| IP intel | ip-api.com (free, no API key, 45 req/min) |
| Device fingerprint | FingerprintJS open-source (MIT) |
| Email | Resend (free tier, 100/day) or Nodemailer + Gmail SMTP fallback |
| Password hashing | bcrypt (12 rounds) |
| Tests | Vitest for backend |
| Linter | ESLint (recommended config) |
| Formatter | Prettier (default config, format on save) |
| Hosting (target) | Vercel (frontend) + Railway/Render (backend) — but local dev only for the class project |

---

## Project structure

```
qr-guard/
├── docs/                 ← all design docs and references
│   ├── AGENTS.md         ← this file
│   ├── GLOSSARY.md
│   ├── INCREMENTS.md
│   ├── SCHEMA.md
│   ├── STATE.md
│   ├── CODEBASE_MAP.md   ← grows as code is built
│   ├── PROMPT_TEMPLATES.md
│   ├── FRS.docx          ← the spec
│   ├── chapter-mapping.md
│   └── uml/              ← all 9 UML diagrams (source + rendered)
├── increments/           ← per-increment plans + notes
│   ├── 01-auth/
│   │   ├── PLAN.md
│   │   └── NOTES.md      ← optional, for tricky decisions during build
│   ├── 02-courses/
│   ├── 03-scan-pipeline/
│   ├── 04-reports/
│   └── 05-notifications/
├── src/
│   ├── backend/
│   │   ├── routes/       ← Express route handlers
│   │   ├── controllers/  ← business logic
│   │   ├── validators/   ← scan pipeline validators (one file each)
│   │   ├── services/     ← email, ip-api, etc
│   │   ├── db/           ← Drizzle schema + migrations
│   │   ├── middleware/
│   │   ├── config/
│   │   └── server.js
│   └── frontend/
│       ├── pages/        ← one HTML page per route
│       ├── styles/
│       ├── scripts/
│       └── assets/
├── tests/                ← integration + e2e tests
└── package.json
```

Don't deviate from this structure without an explicit override.

---

## Commit discipline

After every increment is complete and tested:

- **Conventional commits format:** `feat(inc-1): add user registration and login`
- **One commit per logical unit** — don't squash unrelated changes
- **Reference the increment:** `feat(inc-3): implement scan verification pipeline`
- **Include co-author for Claude:** add the standard Claude Code co-author line

Push after every increment so the maintainer can review.

---

## When to ask vs. when to act

**Ask first when:**
- A spec ambiguity would meaningfully change the implementation
- You're about to introduce a dependency not on the stack list above
- Something in the FRS or UML is contradictory
- You'd be touching multiple increments at once

**Act first when:**
- The decision is unambiguous and matches the FRS
- It's a mechanical task (rename, format, add JSDoc)
- A wrong guess is cheap to fix in 30 seconds

**When in doubt, ask.** Asking is annoying for 5 seconds; rework is annoying for an hour.

---

## Anti-patterns (do not do)

- ❌ Writing code before the plan is approved
- ❌ Inventing fields or methods that aren't in the class diagram
- ❌ Reordering the scan pipeline (sequence + activity diagrams are authoritative)
- ❌ Adding a new dependency without flagging it
- ❌ Committing code that doesn't lint clean
- ❌ Committing code without tests for the verification pipeline
- ❌ Skipping `docs/STATE.md` and `docs/CODEBASE_MAP.md` updates
- ❌ Long unbroken sessions (use `/clear` between increments)
- ❌ Working from memory instead of re-reading the docs at the start of each session

---

## Quick reference

| Need | Go to |
|---|---|
| What's the spec? | `docs/FRS.docx` |
| What's the data model? | `docs/SCHEMA.md` and `docs/uml/04-class-diagram.svg` |
| What's the scan pipeline order? | `docs/uml/02-sequence-scan.svg` |
| What term means what? | `docs/GLOSSARY.md` |
| What increment am I on? | `docs/STATE.md` |
| What files exist? | `docs/CODEBASE_MAP.md` |
| How do I write the prompt for X? | `docs/PROMPT_TEMPLATES.md` |
| What's the architecture? | `docs/uml/08-architecture.svg` |
