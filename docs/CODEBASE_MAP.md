<!--
last_updated: 2026-04-16
audience: Claude Code (locate files), maintainer (review structure)
role: a one-line description of every code file in the project
-->

# CODEBASE_MAP.md

> Every code file in the project, with a one-line description. Update this whenever you add, rename, or significantly repurpose a file. Lets Claude Code (and any new team member) understand the codebase without reading every file.

---

## Status

⏳ Project not yet started. This document will populate as code is written.

---

## Expected structure (empty project)

```
src/
├── backend/
│   ├── routes/        ← (Express route definitions, one file per resource)
│   ├── controllers/   ← (request handlers, business logic orchestration)
│   ├── validators/    ← (the 6-layer scan pipeline classes — see GLOSSARY.md)
│   ├── services/      ← (external integrations: email, ip-api, etc.)
│   ├── db/            ← (Drizzle schema files, migrations, query helpers)
│   ├── middleware/    ← (auth, error handling, rate limiting)
│   ├── config/        ← (constants, env loading)
│   └── server.js      ← (Express app entry point)
└── frontend/
    ├── pages/         ← (one HTML file per route)
    ├── styles/        ← (one CSS file per page or shared base.css)
    ├── scripts/       ← (one JS file per page; shared utils in /shared)
    └── assets/        ← (images, icons, fonts)

tests/
├── unit/              ← (Vitest unit tests, mirrors src/backend structure)
├── integration/       ← (Vitest API tests with test database)
└── e2e/               ← (manual smoke test scripts)

increments/
├── 01-auth/
│   ├── PLAN.md        ← (the approved plan for this increment)
│   └── NOTES.md       ← (optional, decisions made during build)
├── 02-courses/
├── 03-scan-pipeline/
├── 04-reports/
└── 05-notifications/
```

---

## Files (alphabetical, populated as built)

| File | Purpose |
|---|---|
| _(none yet)_ | |

---

## Update template

When adding a file, add a row in this format:

```
| `src/backend/validators/geofence-checker.js` | Layer 5 of scan pipeline; PostGIS ST_DWithin against course geofence + 15m margin |
```

Sort alphabetically by full path within the table.
