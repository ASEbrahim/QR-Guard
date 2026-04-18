# AUDIT 08: Configuration Drift Report

**Date:** 2026-04-18
**Auditor:** Claude Opus 4.7 (1M context)
**Scope:** `constants.js` vs code, Drizzle schema vs migrations vs `docs/SCHEMA.md`, `.env.example` vs `render.yaml` vs `server.js`, `README.md` vs `package.json`, `drizzle.config.js` vs schema path, `vitest.config.js` vs tests, `eslint.config.js` vs lint, `package.json` engines vs used features, docs (`FRS.docx`, `CODEBASE_MAP.md`, `STATE.md`, `GLOSSARY.md`, `INCREMENTS.md`, `SESSION_REPORT*.md`, `CLAUDE.md`) vs implementation.
**Status:** READ-ONLY audit (no files modified).

> Prior audits referenced (not repeated here): AUDIT_02 (concurrency), AUDIT_03 (SQL injection), AUDIT_06 (auth boundaries). The "magic numbers moved to constants" consolidation described in `SESSION_REPORT_FULL.md` is already done and has been re-verified; no constant is duplicated as a literal elsewhere in production code (see §1).

---

## Summary Table

| # | Severity | Category | File(s) | One-line |
|---|---------|----------|---------|----------|
| D1 | **HIGH** | env drift | `.env.example`, `render.yaml` vs `server.js:35`, `socket-service.js:48` | `ALLOWED_ORIGIN` is required for production CORS but is undocumented in `.env.example` **and** missing from `render.yaml` envVars — silent CORS misconfig on fresh deploy. |
| D2 | **HIGH** | schema vs docs | `drizzle/0001_sudden_scalphunter.sql`, `audit-log.schema.js` vs `docs/SCHEMA.md:170`, `INCREMENTS.md:266`, `SESSION_REPORT_FULL.md:109` | `audit_log_target_idx` is claimed as "added" in SCHEMA.md and both session reports, but the index exists in **neither the Drizzle schema nor any migration**. Reports that filter by `target_id` (`report-controller.js:252`) do full scans. |
| D3 | **HIGH** | schema vs docs | `drizzle/0000_outstanding_psynapse.sql`, `course.schema.js` vs `docs/SCHEMA.md:84` | `courses_instructor_idx` documented in SCHEMA.md is **not in the Drizzle schema and not in any migration**. All instructor-scoped course lookups (`listCourses`, ownership checks) sequentially scan courses. |
| D4 | **HIGH** | migration vs docs | all three files under `drizzle/` vs `docs/SCHEMA.md:16-19,251` | SCHEMA.md requires `CREATE EXTENSION "uuid-ossp"` and `CREATE EXTENSION "postgis"` as migration step 1, but **no migration file contains either `CREATE EXTENSION` statement**. The schema relies on `gen_random_uuid()` (pgcrypto/builtin on PG 13+) and PostGIS functions; on a Postgres without these enabled, first migration or first scan errors out. Neon happens to pre-enable PostGIS and has `gen_random_uuid` built in, so production works by accident. |
| D5 | **MEDIUM** | env drift | `.env.example` vs `server.js:41-46` | `SESSION_SECRET=change-me-in-production` in `.env.example` is the exact sentinel that `server.js` treats as "unset" and refuses to start against. Anyone who copies the file verbatim hits the production-refusal branch on first `NODE_ENV=production` boot. |
| D6 | **MEDIUM** | env drift | `render.yaml` vs `server.js:34-36`, `socket-service.js:48` | `ALLOWED_ORIGIN` and `RESEND_API_KEY` are referenced by production code but are not declared in `render.yaml` envVars at all (only `NODE_ENV`, `DATABASE_URL`, `SESSION_SECRET`, `EMAIL_PROVIDER`, `BASE_URL` are). Render blueprint deploy will not prompt for these. |
| D7 | **MEDIUM** | README vs package.json | `README.md:47-53` vs `package.json:6-16` | README documents `npm install / npm run dev / npm test / npm run lint`. The `seed.js` and `screenshot-*.js` scripts documented in `CODEBASE_MAP.md:205-206` have **no corresponding `npm run` scripts** in `package.json`. They must be invoked via raw `node scripts/…`. |
| D8 | **MEDIUM** | README/seed vs screenshot scripts | `scripts/screenshot-all.js:7`, `scripts/screenshot-mobile.js:7` vs `server.js:95`, `vitest.config.js:14` | Screenshot scripts hardcode `BASE = 'http://localhost:3001'` while the server defaults to `PORT=3000` (from `server.js:95` and `.env.example:12`). Running `npm run dev` + screenshot scripts without also exporting `PORT=3001` produces no screenshots (connection refused), contradicting `CODEBASE_MAP.md:206`. |
| D9 | **MEDIUM** | FRS/docs vs code | `docs/SESSION_REPORT_FULL.md:109,286-295`, `INCREMENTS.md:22-31`, `docs/DOCUMENT_UPDATE_INSTRUCTIONS.md` vs `FRS.docx` | Per STATE.md §Next steps and DOCUMENT_UPDATE_INSTRUCTIONS, **FRS v1.1 still documents the old design**: hosting = Vercel + Railway (code is Render + Neon), email verify via link (code is 6-digit code, `auth-controller.js:60-62,99-107`), device binding at login (code: device binding moved to scan pipeline per SESSION_REPORT_FULL:130, 138), register includes instructors (code: student-only, `auth-controller.js:70-95` accepts both; see D10). The FRS → v2.0 update is explicitly listed as pending. |
| D10 | **MEDIUM** | docs vs code | `INCREMENTS.md:19-24`, `SESSION_REPORT_FULL.md:196`, `CODEBASE_MAP.md:152` vs `auth-controller.js:28,92`, `register.html` | Docs claim "student-only registration; instructors provisioned via seed script". Backend `registerSchema` still accepts `role: z.enum(['student', 'instructor'])` and inserts into the instructors table when `role==='instructor'`. Only the frontend hides the instructor toggle. A direct POST to `/api/auth/register` can still self-register an instructor account. |
| D11 | **LOW** | schema defaults vs constants | `course.schema.js:17-21` vs `constants.js:25-27` | Defaults are duplicated between Drizzle schema (`.default(300)`, `.default('85.00')`, `.default(25)`) and `constants.js` (`DEFAULT_ATTENDANCE_WINDOW_SECONDS=300`, `DEFAULT_WARNING_THRESHOLD_PCT=85.0`, `DEFAULT_QR_REFRESH_INTERVAL_SECONDS=25`). Changing the constant does **not** change existing-row semantics or the DB-side default (migration-baked); a doc-stated "no magic numbers" commitment is partially broken at the schema layer. |
| D12 | **LOW** | schema vs SCHEMA.md | `attendance.schema.js:21` vs `docs/SCHEMA.md:146` | `ip_address` is stored as `text` not `inet`. Already flagged as an intentional deviation in `STATE.md:53`; the deviation note is present in SCHEMA.md:146 — acceptable but re-confirm. |
| D13 | **LOW** | schema vs SCHEMA.md | `course.schema.js:4-26` vs `docs/SCHEMA.md:66-83` | `courses.semester_start` and `courses.semester_end` are in the Drizzle schema + migration but **not in the SCHEMA.md `courses` column table** — only referenced obliquely in STATE.md:51. Docs → code drift in the canonical schema doc. |
| D14 | **LOW** | schema docs vs SCHEMA.md | `audit-log.schema.js:7-14` vs `docs/SCHEMA.md:157-166` | `audit_log.reason` allowed-value list in SCHEMA.md (`'qr_expired', 'device_mismatch', 'location_failed', 'outside_geofence', 'already_recorded', 'override_present', 'override_absent', 'override_excused'`) excludes codes used in code: `'gps_accuracy_failed'` (`gps-accuracy-checker.js:13,17`), `'course_not_found'` (`geofence-checker.js:28`). GLOSSARY.md:63 mentions the codes exist; SCHEMA.md reason list is stale. |
| D15 | **LOW** | gitignore vs reality | `.gitignore` (8 lines) vs `package.json:11` + screenshot scripts | `.gitignore` covers `node_modules/, dist/, .env, .env.local, *.log, .DS_Store, coverage/, .vitest/`. Missing: `test-results/` (the output dir of both screenshot scripts, `scripts/screenshot-all.js:8`, `scripts/screenshot-mobile.js:8` — plus it exists as a tracked subdir in the repo). |
| D16 | **LOW** | CODEBASE_MAP.md vs disk | `docs/CODEBASE_MAP.md:22` vs `package.json:21-46` | CODEBASE_MAP claims "17 prod + 8 dev dependencies". `package.json` shows **16 prod + 7 dev**. `SESSION_REPORT_FULL.md:19-20` says "Production dependencies 15 / Dev 7". All three numbers disagree. |
| D17 | **LOW** | CODEBASE_MAP.md vs disk | `docs/CODEBASE_MAP.md:197` | "Total: 43 tests across 9 files." Test file count re-check: `scan-verifier.test.js`, `gps-accuracy-checker.test.js`, `ip-validator.test.js`, `device-checker.test.js`, `qr-validator.test.js`, `notification-service.test.js`, `attendance-calculator.test.js`, `session-generator.test.js`, `auth-flow.test.js` — 9 files (matches). Test count not re-verified but self-reported via `npm test`; likely matches. |
| D18 | **LOW** | docs vs docs | `docs/SESSION_REPORT.md:20`, `SESSION_REPORT_FULL.md:16` | "Database Schema (12 tables)" includes `session` (express-session table auto-created by `connect-pg-simple`). SCHEMA.md documents 10 QR-Guard tables; the 12th is mentioned only in the session report. AUDIT_02 also calls out 10 application tables. No drift in reality, but SESSION_REPORT mixes the connect-pg-simple auto-created table into the app schema count. |
| D19 | **INFO** | README vs stack | `README.md:12-20` | README lists `date-fns` in dependencies table (row "GPS" is wrong — actually GPS is browser Geolocation API). `package.json` does include `date-fns@^4.1.0`. But README's stack table omits: `connect-pg-simple`, `csv-stringify`, `express-rate-limit`, `helmet`, `dotenv`, `pg`, `zod`, `bcrypt`, `cors`, `express-session`. Underdocumented stack. |
| D20 | **INFO** | docs vs code | `docs/SESSION_REPORT_FULL.md:109` | Claims "3 unused deps removed (qrcode, date-fns-tz, nodemon)". Verified absent from current `package.json` — cleanup holds. No drift. |

---

## Per-drift writeup

### D1 — `ALLOWED_ORIGIN` is required but undocumented (HIGH)

**Code (server.js:34-36):**
```js
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || 'http://localhost:3000',
  credentials: true,
}));
```

**Code (socket-service.js:48):**
```js
cors: {
  origin: process.env.ALLOWED_ORIGIN || 'http://localhost:3000',
  credentials: true,
},
```

**.env.example (full file, 14 lines):** no `ALLOWED_ORIGIN=`.
**.env (local dev, 7 lines):** no `ALLOWED_ORIGIN=`.
**render.yaml envVars (6 keys):** no `ALLOWED_ORIGIN`.

**Effect on fresh Render deploy:** `ALLOWED_ORIGIN` falls through to `http://localhost:3000` for **both** CORS and Socket.IO. All browser `credentials: true` requests from the real production origin (`qrguard.strat-os.net`) will be blocked. The production deploy only works today because the owner manually added the env var in Render's dashboard — there is no codified declaration of that step.

**Evidence it is required:** `GLOSSARY.md:65-66` ("Set in Render env vars"), `SESSION_REPORT_FULL.md:155` (listed as one of seven production env vars), `DOCUMENT_UPDATE_INSTRUCTIONS.md:265` ("`BASE_URL` and `ALLOWED_ORIGIN` env vars updated on Render"). So this is declared-critical yet nowhere in the version-controlled config.

### D2 — `audit_log_target_idx` documented-but-missing (HIGH)

**SCHEMA.md:170:**
```
**Index:** `CREATE INDEX audit_log_target_idx ON audit_log(target_id);`
```

**INCREMENTS.md:266:** "Key fixes: … audit_log target_id index added …"
**SESSION_REPORT_FULL.md:109:** "… audit_log target_id index, focus ring visibility …"

**Actual `audit-log.schema.js:16-19`:**
```js
(table) => [
  index('audit_log_timestamp_idx').on(table.timestamp),
  index('audit_log_actor_idx').on(table.actorId),
],
```
No target index.

**Actual migration `drizzle/0001_sudden_scalphunter.sql:41-42`:**
```
CREATE INDEX "audit_log_timestamp_idx" ON "audit_log" USING btree ("timestamp");
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_id");
```
No target index.

**Consumer that suffers:** `report-controller.js:252` runs `SELECT COUNT(*) AS total FROM audit_log WHERE target_id = ANY(${sessionIds})` (per AUDIT_03:77-78). With no `target_id` index, this is a seq-scan over the whole append-only log. The audit log is intentionally unbounded, so this degrades as the table grows. The fix was claimed but never landed.

### D3 — `courses_instructor_idx` documented-but-missing (HIGH)

**SCHEMA.md:84:**
```
**Index:** `CREATE INDEX courses_instructor_idx ON courses(instructor_id);`
```

**`course.schema.js`:** no `(table) => [...]` index block at all — only the FK.
**`drizzle/0000_outstanding_psynapse.sql:1-19`:** no index on `instructor_id`.

**Consumer:** every `listCourses` for an instructor, every course-ownership check, every schedule-day page — all filter by `instructor_id`. Missing index is benign at demo scale but visible at the first audit with any class load. Drift is in the canonical schema doc.

### D4 — `CREATE EXTENSION` missing from all migrations (HIGH)

**SCHEMA.md:16-19:**
```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";
```

**SCHEMA.md:251:** "1. Extensions (`uuid-ossp`, `postgis`)" explicitly listed as migration step 1.

**Actual migrations:** all three `drizzle/*.sql` files + `drizzle/meta/*.json` contain zero `CREATE EXTENSION` statements.

**Why production doesn't fail:**
- `gen_random_uuid()` is builtin on PG 13+ (Neon is on PG16) — so `uuid-ossp` was never needed.
- PostGIS is preinstalled on Neon when the PostGIS checkbox is ticked at project creation.

**Drift consequence:** On any fresh non-Neon PG (a dev laptop with a bare `postgres:16` container, the `.env` default `postgresql://qrguard:qrguard@localhost:5432/qrguard`), migration 0001 will succeed up to the first `geofence-checker.js:17-24` scan, which calls `ST_DWithin`/`ST_GeogFromText` and errors out at runtime (`function st_geogfromtext does not exist`). The README's "Local development" section (README.md:80-84) implies local Postgres works; drift means it silently does not, for anything that exercises the geofence layer.

### D5 — `.env.example` default is the sentinel that crashes production (MEDIUM)

**.env.example:9:**
```
SESSION_SECRET=change-me-in-production
```

**server.js:41-46:**
```js
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'change-me') {
  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: SESSION_SECRET is not set or uses default. Refusing to start.');
    process.exit(1);
  }
}
```

The sentinel is `'change-me'` (10 chars). The `.env.example` value is `'change-me-in-production'` (23 chars) — **does not match** the sentinel. A user who copies the example verbatim and deploys with `NODE_ENV=production` will NOT trip the guard and will run with a publicly-known session secret. The guard only catches the literal `'change-me'` (e.g., from an older version of this file).

Drift is in the guard vs the template. Safer fix: either match the sentinel exactly, or use `startsWith('change-me')`.

### D6 — `render.yaml` envVars incomplete (MEDIUM)

**render.yaml declares:** `NODE_ENV`, `DATABASE_URL` (sync:false), `SESSION_SECRET` (generateValue), `EMAIL_PROVIDER=console`, `BASE_URL` (sync:false).

**Code requires in production:**
- `ALLOWED_ORIGIN` — server.js:35, socket-service.js:48 (see D1)
- `RESEND_API_KEY` — email-service.js:13 (only when `EMAIL_PROVIDER=resend`, but render.yaml pins `EMAIL_PROVIDER=console` which contradicts SESSION_REPORT_FULL.md:155 listing production as `EMAIL_PROVIDER=resend`)

So `render.yaml` simultaneously:
1. Pins `EMAIL_PROVIDER=console` (dev-only mode) as the *production* default,
2. Omits `RESEND_API_KEY` (needed when the above is changed to `resend`),
3. Omits `ALLOWED_ORIGIN`.

A fresh apply of this blueprint deploys a CORS-broken, email-silent service.

### D7 — `npm run` doesn't expose `seed` or `screenshot` (MEDIUM)

**package.json:6-16 scripts:** `dev, start, test, test:watch, lint, format, db:push, db:generate, db:studio`.
**CODEBASE_MAP.md:205-206:** documents `node scripts/seed.js`, `node scripts/screenshot-all.js` as standard commands.
**README.md:47-53:** documents only `npm install, npm run dev, npm test, npm run lint`.

No `npm run seed`, no `npm run screenshot`, no `npm run screenshot:mobile`. Low priority but user-facing: the documented workflow cannot be invoked via `npm`.

### D8 — Screenshot scripts hardcode port 3001, server defaults to 3000 (MEDIUM)

**scripts/screenshot-all.js:7:** `const BASE = 'http://localhost:3001';`
**scripts/screenshot-mobile.js:7:** `const BASE = 'http://localhost:3001';`

**server.js:95:** `const PORT = process.env.PORT || 3000;`
**.env.example:12:** `PORT=3000`
**.env:5:** `PORT=3000`
**vitest.config.js:14:** `BASE_URL: 'http://localhost:3000'`

Everything else uses 3000. The screenshot scripts are the sole hold-out on 3001 — presumably a workaround for running screenshots against one server while `npm run dev` ran another. This is undocumented anywhere and directly contradicts `CODEBASE_MAP.md:206`'s "Run: `node scripts/screenshot-all.js`" which implies it works out of the box.

### D9 — FRS documents the *pre-implementation* design (MEDIUM)

Per `docs/STATE.md:68` and `docs/DOCUMENT_UPDATE_INSTRUCTIONS.md:13-108`, the FRS file at `docs/FRS.docx` still reads as v1.1 and documents:

| FRS v1.1 says | Code says |
|---|---|
| Hosting: Vercel + Railway | Render + Neon (`render.yaml`, `database.js:10`) |
| Email verification via link | 6-digit code (`auth-controller.js:60-62,99-107`, `email-service.js:129-143`) |
| Device binding at login | Device binding in scan pipeline (`device-checker.js`, `validators/scan-verifier.js`) |
| Instructor self-registration | Student-only (per docs; but see D10 — code still allows instructor) |
| Link-expiry defaults | Match code (24h verify, 1h reset, 1h rebind — `constants.js:11-13`) |

This is called out in STATE.md:68 as "Next step: Update FRS v1.1 to v2.0" — so the drift is *known*, but it is live today, and anyone reading the FRS as "the spec" per CLAUDE.md:10 is reading a stale document.

### D10 — Register endpoint accepts instructor role despite "student-only" claim (MEDIUM)

**Doc claims** (INCREMENTS.md:19-24, CODEBASE_MAP.md:152, SESSION_REPORT_FULL.md:196): "Student-only registration; instructors provisioned via seed script."

**auth-controller.js:28:** `role: z.enum(['student', 'instructor'])`
**auth-controller.js:70-95:** the `register` handler inserts into the `instructors` table when `role === 'instructor'`.

**register.html:** per CODEBASE_MAP.md:152 "instructor field hidden" — but hidden-in-UI does not equal server-side rejection. Any `curl -X POST /api/auth/register -d '{"role":"instructor", …}'` succeeds (subject to email uniqueness). This is a security-relevant drift: docs claim a server-enforced restriction that the server does not enforce.

### D11 — Schema-baked defaults duplicate `constants.js` (LOW)

**course.schema.js:17-21:**
```js
attendanceWindowSeconds: integer('attendance_window_seconds').notNull().default(300),
warningThresholdPct: numeric('warning_threshold_pct', { precision: 5, scale: 2 })
  .notNull()
  .default('85.00'),
qrRefreshIntervalSeconds: integer('qr_refresh_interval_seconds').notNull().default(25),
```

**constants.js:25-27:**
```js
export const DEFAULT_ATTENDANCE_WINDOW_SECONDS = 300;
export const DEFAULT_WARNING_THRESHOLD_PCT = 85.0;
export const DEFAULT_QR_REFRESH_INTERVAL_SECONDS = 25;
```

The controller uses the constants (`course-controller.js:124-126`). The schema hardcodes the same literals for DB-side defaults. A single-point-of-truth fix would import the constants into `course.schema.js`. Minor because the values agree today and the CLAUDE.md "no magic numbers" rule applies primarily to control flow.

### D12 — `ip_address text vs inet` (LOW, already acknowledged)

`attendance.schema.js:21` stores `ip_address` as `text`. SCHEMA.md:146 already notes the deviation. STATE.md:53 lists it under "Deviations from plan". Acceptable — flagged only for completeness.

### D13 — `semester_start / semester_end` absent from SCHEMA.md courses table (LOW)

Columns exist in the schema/migration (`course.schema.js:23-24`, `drizzle/0000_outstanding_psynapse.sql:15-16`) and are required for `session-generator.js`. The SCHEMA.md `courses` table at lines 66-83 omits both columns. STATE.md:51 lists it under "Deviations from plan", so the omission is known; fix is to add them to SCHEMA.md proper.

### D14 — Audit-log `reason` code list in SCHEMA.md is incomplete (LOW)

**SCHEMA.md:165:** `'qr_expired', 'device_mismatch', 'location_failed', 'outside_geofence', 'already_recorded', 'override_present', 'override_absent', 'override_excused'`

**Actual codes used in code:**
- `'qr_expired'` — `qr-validator.js`
- `'device_mismatch'` — `device-checker.js`
- `'location_failed'` — `ip-validator.js:34,38`
- `'gps_accuracy_failed'` — `gps-accuracy-checker.js:13,17` (MISSING FROM DOC)
- `'outside_geofence'` — `geofence-checker.js:32`
- `'course_not_found'` — `geofence-checker.js:28` (MISSING FROM DOC)
- plus `'already_recorded'`, `'override_*'` from scan/override controllers.

GLOSSARY.md:63 references all codes generally but SCHEMA.md's enum-style list is out of date.

### D15 — `.gitignore` missing `test-results/` (LOW)

**scripts/screenshot-all.js:8:** `const OUT = 'test-results/screenshots';`
**scripts/screenshot-mobile.js:8:** `const OUT = 'test-results/screenshots';`
**.gitignore (full):**
```
node_modules/
dist/
.env
.env.local
*.log
.DS_Store
coverage/
.vitest/
```

The `test-results/` directory created by both screenshot scripts is not ignored, and the repo already contains a tracked `test-results/` path (per initial repo listing). PNG screenshots accumulate in-tree unless manually deleted.

### D16 — Dependency count disagreement across three docs (LOW)

| Source | Prod deps | Dev deps |
|---|---|---|
| `package.json` (actual) | 16 | 7 |
| `CODEBASE_MAP.md:22` | 17 | 8 |
| `SESSION_REPORT_FULL.md:19-20` | 15 | 7 |

No single number agrees. Actual count: `bcrypt, connect-pg-simple, cors, csv-stringify, date-fns, dotenv, drizzle-orm, express, express-rate-limit, express-session, helmet, pg, resend, socket.io, zod` = **15 prod, not 16** — wait, re-count: package.json lists 16 prod entries including those plus `date-fns`. Counting line-by-line of `package.json:22-36` gives 15 production dependencies (lines 22-36 inclusive is 15 lines). CODEBASE_MAP says 17, SESSION_REPORT says 15. Drift is purely documentation; code works.

### D17 / D18 — ancillary doc arithmetic drift

D17: test file count claim (9 files) matches disk; test count (43 tests) not re-verified in this READ-ONLY pass but matches STATE.md and SESSION_REPORT. No drift.

D18: `SESSION_REPORT.md` counts `session` (express-session's auto-created table) into "12 tables" alongside the 10 QR-Guard schema tables + `warning_email_log`. SCHEMA.md documents 10 app tables (or 9 application + 1 log). Not a code bug; just heterogeneous counting.

### D19 — `README.md` stack table underspecifies dependencies (INFO)

README.md:12-20 names 10 rows. Actual `package.json` production deps include 15 packages; missing from README: `connect-pg-simple`, `csv-stringify`, `express-rate-limit`, `helmet`, `dotenv`, `pg`, `zod`, `bcrypt`, `cors`, `express-session`. README's audience is outside contributors/professor; undercounting the security stack (helmet, rate-limit, bcrypt) is noteworthy for a CSIS 330 deliverable.

### D20 — Dependency cleanup claim holds (INFO)

SESSION_REPORT_FULL.md:109 claims `qrcode`, `date-fns-tz`, `nodemon` were removed. None appear in current `package.json`. `date-fns` is still used (`session-generator.js:1`). No drift.

---

## Cross-cutting findings

### HIGH-risk findings (deploy-impacting)

- **D1** — `ALLOWED_ORIGIN` silently broken on fresh deploy.
- **D2** — audit_log target_id index claimed-but-absent; affects every audit-log-by-target query.
- **D3** — courses_instructor_idx claimed-but-absent; affects every instructor landing page.
- **D4** — `CREATE EXTENSION` statements absent from migrations; only works on Neon by accident.

### MEDIUM-risk (correctness + security)

- **D5** — `.env.example` sentinel mismatch bypasses the crash-on-default guard.
- **D6** — render.yaml envVars incomplete.
- **D9** — FRS documents pre-implementation hosting/email/device-binding.
- **D10** — `/api/auth/register` accepts `role: 'instructor'` despite "student-only" doc claim.
- **D7**, **D8** — developer-experience drift in scripts/ports.

### LOW-risk (documentation tidy-up)

- D11 (schema defaults duplicate constants)
- D12, D13, D14 (SCHEMA.md incomplete in three places)
- D15, D16, D17, D18, D19, D20 (doc arithmetic, gitignore, README stack)

---

## Priority order (if fixing)

1. **D4** — add `CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS pgcrypto;` to migration 0000 (or a prelude migration). Without this, local dev is silently broken for the scan pipeline.
2. **D1 / D6** — declare `ALLOWED_ORIGIN` and `RESEND_API_KEY` in `render.yaml` and `.env.example`; add `EMAIL_PROVIDER=resend` override note.
3. **D10** — server-side reject `role === 'instructor'` in `register` (change `z.enum` to `z.literal('student')` or gate behind a seed-only admin flag). Doc-vs-code is a security claim that code doesn't honor.
4. **D5** — change `.env.example` `SESSION_SECRET` to the exact `change-me` sentinel, OR extend the guard to `startsWith('change-me')`.
5. **D2 / D3** — add the two missing indexes in a new migration (or delete the docs claims). Both would land in a single Drizzle-generated migration.
6. **D9** — publish FRS v2.0 per DOCUMENT_UPDATE_INSTRUCTIONS (already planned in STATE.md).
7. **D14, D13, D11** — SCHEMA.md tidy-up: add `semester_start/end`, add missing reason codes, import constants into schema file.
8. **D7, D8** — expose `seed` and `screenshot` via `npm run`; fix port mismatch.
9. **D15, D16, D17, D18, D19, D20** — cosmetic doc pass.

---

*End of AUDIT 08 — Configuration Drift Report*
