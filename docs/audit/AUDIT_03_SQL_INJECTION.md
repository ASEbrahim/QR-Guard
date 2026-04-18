# AUDIT 03: SQL Injection Vulnerability Analysis

**Date**: 2026-04-18
**Auditor**: Claude Opus 4.7 (1M context)
**Scope**: All JavaScript files under `~/Downloads/csis/QR-Guard/src/` plus `tests/`, `scripts/`, and `drizzle/` migrations.
**Target application**: QR-Guard — QR-based attendance system (Node.js + Express + Drizzle ORM + PostgreSQL/PostGIS).
**Methodology**: Full-text search for every `db.execute(` call, every Drizzle ``sql`` `` tagged-template, every `pool.query()` / `.raw()` call, every `ORDER BY` / `LIMIT` clause, every search/filter endpoint, and every migration file. Manual trace of user input from HTTP handler (`req.body` / `req.params` / `req.query`) to the database driver.

---

## Executive Summary

**Total raw-SQL call sites audited**: 26 `db.execute(sql\`...\`)` invocations (9 in production code, 17 in tests).
**Total Drizzle query-builder calls inspected**: ~40 `db.select() / db.insert() / db.update()` patterns.
**Raw `pool.query()` calls**: 0.
**`sql.raw()` calls**: 0.

| Severity | Count |
|----------|:----:|
| Critical | 0 |
| High     | 0 |
| Medium   | 0 |
| Low      | 0 |
| Informational | 2 |

**Conclusion**: The QR-Guard backend is **free of SQL-injection vulnerabilities**. All nine production raw-SQL sites use Drizzle's `sql` tagged-template with `${}` interpolation, which Drizzle compiles to PostgreSQL bind-parameter placeholders (`$1`, `$2`, …). No string concatenation, f-string-style templating, dynamic column/table names, or `sql.raw()` is used anywhere in the codebase. User-controlled pagination (`LIMIT`/`OFFSET`) is bounded via `parseInt` + `Math.min`/`Math.max` before parameterization. Search/filter endpoints rely on Drizzle's type-safe builder (`eq`, `and`, `inArray`, `gte`, `lte`, `isNull`), not string SQL.

---

## Methodology

### Search patterns executed
| # | Pattern | Matches (production) | Notes |
|---|---------|:---:|------|
| 1 | `db.execute` | 9 | All wrap `sql\`…\`` — parameterized |
| 2 | `` sql` `` | 9 (production) + 17 (tests) | All use `${}` interpolation only |
| 3 | `pool.query` | 0 | Raw pg client never used directly |
| 4 | `.raw(` | 0 | `sql.raw()` never invoked |
| 5 | `${` inside SQL | all production sites | Every interpolation traced |
| 6 | `ORDER BY` (raw) | 1 | hardcoded `ORDER BY timestamp DESC` |
| 7 | `LIMIT` (raw) | 1 | `${limit} OFFSET ${offset}` — parameterized, bounded |
| 8 | `orderBy(` (Drizzle) | 5 | All reference Drizzle column objects, no user input |
| 9 | ST_GeogFromText / ST_DWithin | 1 | WKT cast against a column value (not user input) |
| 10 | Migrations `drizzle/*.sql` | 3 files | DDL only, no dynamic input |

### Files containing SQL (production code)
| File | Raw `sql` sites | Parameterized? | Tainted input? |
|------|:---:|:---:|:---:|
| `src/backend/validators/geofence-checker.js` | 1 | Yes | No (validated `number`) |
| `src/backend/services/attendance-calculator.js` | 2 | Yes | No (UUIDs from session/params) |
| `src/backend/services/notification-service.js` | 1 | Yes | No |
| `src/backend/services/qr-service.js` | 1 | Yes | No (no user input) |
| `src/backend/controllers/scan-controller.js` | 1 | Yes | No |
| `src/backend/controllers/report-controller.js` | 2 | Yes | No (bounded ints + array of UUIDs) |
| `src/backend/controllers/auth-controller.js` | 0 | — | — |
| `src/backend/controllers/course-controller.js` | 0 | — | — |
| `src/backend/controllers/override-controller.js` | 0 | — | — |
| `src/backend/controllers/session-controller.js` | 0 | — | — |
| `src/backend/validators/audit-logger.js` | 0 | — | — |
| `src/backend/middleware/auth-middleware.js` | 0 | — | — |

### Files containing SQL (tests)
All test files (`qr-validator.test.js`, `attendance-calculator.test.js`, `device-checker.test.js`, `tests/integration/auth-flow.test.js`) issue `DELETE FROM <hardcoded table>` tear-down statements — none accept external input. Listed for completeness only.

---

## Detailed call-site table

| # | File | Line(s) | Query fragment | Dynamic values | Source of values | Parameterized? | Tainted? |
|---|------|---------|----------------|----------------|-------------------|:---:|:---:|
| 1 | `validators/geofence-checker.js` | 17–25 | `SELECT ST_DWithin(ST_GeogFromText(geofence_center), ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, geofence_radius_m + ${GEOFENCE_INDOOR_MARGIN_M}) AS within FROM courses WHERE course_id = ${courseId}` | `lng`, `lat`, `GEOFENCE_INDOOR_MARGIN_M`, `courseId` | `lng/lat` from `verifyScan` after zod `z.number().min(-90).max(90)` validation in `scan-controller.js:11-13`; `courseId` is a UUID read from the DB in `qr-validator.js` (not user-supplied directly). `GEOFENCE_INDOOR_MARGIN_M` is a compile-time constant. | **Yes** | No |
| 2 | `services/attendance-calculator.js` | 16–33 | `WITH session_statuses AS (... WHERE s.course_id = ${courseId} ...  AND a.student_id = ${studentId} ...)` | `courseId`, `studentId` | UUIDs from route params and `req.session.userId` | **Yes** | No |
| 3 | `services/attendance-calculator.js` | 47–69 | `WHERE e.course_id = ${courseId} ... AND s.course_id = ${courseId}` | `courseId` | UUID from route params | **Yes** | No |
| 4 | `services/notification-service.js` | 132–134 | `SELECT COUNT(*) AS cnt FROM sessions WHERE course_id = ${courseId} AND status = 'closed'` | `courseId` | UUID from caller (scan pipeline) | **Yes** | No |
| 5 | `services/qr-service.js` | 109 | `DELETE FROM qr_tokens WHERE expires_at < now() - INTERVAL '1 hour'` | (none) | Hardcoded literal | **Yes** (no dynamic parts) | No |
| 6 | `controllers/scan-controller.js` | 67–75 | `SELECT COUNT(*) FILTER (...) ... LEFT JOIN attendance a ON a.session_id = ${result.sessionId} ... INNER JOIN sessions s ON s.course_id = e.course_id AND s.session_id = ${result.sessionId}` | `result.sessionId` | UUID returned from `verifyScan()` (originated from the decoded QR payload whose signature/expiry are validated in `qr-validator.js`) | **Yes** | No |
| 7 | `controllers/report-controller.js` | 245–250 | `SELECT * FROM audit_log WHERE target_id = ANY(${sessionIds}) ORDER BY timestamp DESC LIMIT ${limit} OFFSET ${offset}` | `sessionIds` (UUID[]), `limit`, `offset` | `sessionIds` from a preceding `db.select()` on the `sessions` table (server-controlled UUIDs). `limit`/`offset` from query string via `Math.min(100, Math.max(1, parseInt(…) || 50))` and `(page - 1) * limit` — forced to bounded integers before reaching SQL. `ORDER BY timestamp DESC` is a hardcoded literal. | **Yes** | No |
| 8 | `controllers/report-controller.js` | 252–255 | `SELECT COUNT(*) AS total FROM audit_log WHERE target_id = ANY(${sessionIds})` | `sessionIds` | Same server-derived UUID array as #7 | **Yes** | No |

All 8 production-code sites pass the test.

---

## Drizzle query-builder review

The majority of database access in QR-Guard uses Drizzle's type-safe query builder: `db.select()`, `db.insert()`, `db.update()`, `db.delete()` combined with helper predicates (`eq`, `and`, `or`, `isNull`, `gte`, `lte`, `inArray`, `desc`). These compile to `$N` bind-parameter PostgreSQL queries internally — there is no string interpolation path. No call site was found that bypasses the builder to inject raw SQL into `.where()` / `.orderBy()`.

- `orderBy()` is invoked 5 times (`qr-service.js:99`, `course-controller.js:218`, `report-controller.js:25, 103, 149`). Each passes a Drizzle *column* reference (e.g. `sessions.scheduledStart`, `desc(qrTokens.generatedAt)`) — never a user-supplied string. No dynamic column-name injection possible.
- `inArray()` is used in `report-controller.js:36, 107, 159` for `sessionId` lists. The helper binds each array element as a separate parameter (or PG `ANY($1)`), so oversized / malicious input produces a query-planner error, not SQL injection.

---

## PostGIS / WKT analysis (special focus)

`geofence-checker.js:17-25` is the only PostGIS raw-SQL site. Two aspects required careful verification:

### (a) Student GPS coordinates
`${lng}` and `${lat}` are interpolated into `ST_SetSRID(ST_MakePoint(…), 4326)`. Source-trace:
```
req.body → scanSchema.safeParse → z.number().min(-90).max(90) (lat) / z.number().min(-180).max(180) (lng) → verifyScan({ gpsLat, gpsLng }) → checkGeofence(courseId, lat, lng)
```
Both values are numeric after zod validation. Drizzle binds them as `$N` parameters, so even if validation were bypassed the driver would coerce non-numeric input to strings and PostgreSQL would raise a type error — no SQL injection route exists.

### (b) Stored WKT (geofence_center column)
`geofence_center` is a `text` column containing a WKT string such as `SRID=4326;POINT(47.98 29.31)`. The value is *stored*, not interpolated: the raw SQL references the column name `geofence_center`, not any variable. `ST_GeogFromText(geofence_center)` parses the column value as WKT at query time — SQL injection is not reachable through this column because it is never concatenated into the SQL text.

Note: The WKT string itself is built in `course-controller.js:111` and `235` from `geofenceLat` / `geofenceLng` supplied by instructors. In `createCourse` (line 111) those numbers are zod-validated (`z.number().min/max`). In `updateCourse` (line 235) the values are read from `req.body` **without zod validation** and string-formatted into the WKT — *however*, that WKT is then written to PostgreSQL via Drizzle's `update()` builder (line 255), which parameter-binds the value. It is stored as text; it never becomes part of the SQL statement. Even a malicious instructor who writes `'; DROP TABLE courses; --` into `geofenceLng` would only have that literal string persisted in `geofence_center`. When `ST_GeogFromText` later reads it, PostGIS would raise a WKT parse error. Not a SQL-injection vector. (A separate *geofence-bypass* / data-validation concern may exist — outside the SQL-injection scope. Recommend surfacing to AUDIT_04 or a dedicated input-validation audit if not already covered.)

---

## Migration / DDL review

`drizzle/0000_outstanding_psynapse.sql`, `drizzle/0001_sudden_scalphunter.sql`, `drizzle/0002_known_aqueduct.sql` — all three are auto-generated by `drizzle-kit` from schema definitions. They contain only static DDL (`CREATE TABLE`, `ALTER TABLE … ADD CONSTRAINT`, `CREATE INDEX`, and one `CREATE TRIGGER` for audit-log append-only enforcement). No dynamic SQL, no user input. The trigger function `reject_audit_log_modify()` simply raises an exception and does not reference any user data.

---

## Dynamic pagination / filter review

`report-controller.js:229-231` builds `limit` / `offset`:
```js
const page   = Math.max(1, parseInt(req.query.page)  || 1);
const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
const offset = (page - 1) * limit;
```
All three variables are guaranteed integers in `[1, 100]` (limit) and `[0, ∞)` (offset) before being parameterized via `${limit}` / `${offset}` in the `sql` tagged template — safe from SQL injection and additionally safe from oversize-pagination DoS.

`report-controller.js:146-148` builds CSV-export date filters:
```js
if (req.query.from) conditions.push(gte(sessions.scheduledStart, new Date(req.query.from)));
if (req.query.to)   conditions.push(lte(sessions.scheduledStart, new Date(req.query.to)));
```
These feed Drizzle's `gte()` / `lte()` helpers — parameter-bound. The `new Date(malformed)` would yield `Invalid Date`, which the PostgreSQL driver serialises as `NaN`/`null` — no injection path.

`report-controller.js:180-181` filters in memory (`continue` in a JS loop), not in SQL — no injection risk.

---

## Informational findings (defense-in-depth)

### INFO-1: `updateCourse` does not zod-validate geofence updates
**Location**: `src/backend/controllers/course-controller.js:234-243`

`updateCourse` constructs `geofenceCenter = "SRID=4326;POINT(${lng} ${lat})"` directly from `req.body.geofenceLng` / `req.body.geofenceLat` without zod validation — unlike `createCourse` (lines 31-32) which uses `z.number().min(-90).max(90)` and `z.number().min(-180).max(180)`.

**Impact on SQL injection**: **None** — the WKT is stored via Drizzle's parameter-bound `update()` builder, not concatenated into SQL. However, a malicious instructor could store arbitrary text in the `geofence_center` column (e.g. `POINT(999 999)` or a syntactically invalid WKT). This is a *data-integrity / geofence-bypass* issue rather than SQL injection. Out of scope for AUDIT_03 but worth flagging to the next audit.

**Recommended fix (defense-in-depth)**: Add a zod `updateCourseSchema` mirroring `createCourseSchema` for `geofenceLat` / `geofenceLng` / `geofenceRadius` / `attendanceWindow` / `warningThreshold` / `qrRefreshInterval`.

### INFO-2: Raw SQL sites lack inline comments stating parameterization safety
**Location**: All 8 production `db.execute(sql\`…\`)` sites.

Future maintainers may attempt to refactor toward string concatenation (e.g. to add a conditional `WHERE` fragment). A short comment such as `// All ${…} values bind as $N parameters — do not replace with string concat.` above each site would reduce this risk.

**No action required** for current code.

---

## Previously audited (SESSION_REPORT_FULL.md)

The project's prior session report (`docs/SESSION_REPORT_FULL.md:68`) explicitly notes that the geofence check uses `ST_GeogFromText()` against a stored WKT column and that Drizzle tagged templates are used elsewhere. This audit confirms those statements are accurate and complete: no additional raw-SQL call sites have been introduced since that report.

---

## Representative proof of parameterization

Representative example — `services/attendance-calculator.js:16-33`:
```js
const result = await db.execute(sql`
  WITH session_statuses AS (
    SELECT
      s.session_id,
      COALESCE(a.status, 'absent') AS effective_status
    FROM sessions s
    LEFT JOIN attendance a
      ON a.session_id = s.session_id
      AND a.student_id = ${studentId}       -- → $1
    WHERE s.course_id = ${courseId}          -- → $2
      AND s.status = 'closed'
  )
  SELECT
    COUNT(*) FILTER (WHERE effective_status = 'present') * 100.0
    / NULLIF(COUNT(*) FILTER (WHERE effective_status IN ('present', 'absent')), 0)
    AS attendance_pct
  FROM session_statuses
`);
```
Drizzle's `sql` tagged template separates static SQL fragments from interpolated values. Static fragments are concatenated into the query string; interpolated values (`${studentId}`, `${courseId}`) become `$1`, `$2` bind parameters sent separately to the PostgreSQL driver. Injection is impossible so long as the `sql` template literal is used (not `sql.raw()`).

Representative example — `controllers/report-controller.js:245-250`:
```js
const result = await db.execute(sql`
  SELECT * FROM audit_log
  WHERE target_id = ANY(${sessionIds})   -- → $1 (UUID[])
  ORDER BY timestamp DESC                 -- hardcoded
  LIMIT ${limit} OFFSET ${offset}          -- → $2, $3 (bounded ints)
`);
```
`sessionIds` is a server-derived UUID array; `limit` / `offset` are bounded integers; `ORDER BY` is a hardcoded column literal. All three interpolations are parameterized.

---

## Conclusion

QR-Guard demonstrates **exemplary SQL-injection hygiene**:

1. **100% parameterized raw SQL** — every one of the 8 production `db.execute(sql\`…\`)` sites interpolates only via `${}`, which Drizzle converts to PostgreSQL bind parameters. Zero `sql.raw()`, zero `pool.query()`, zero string concatenation.
2. **No user-controlled column or table names** — `orderBy()` always receives Drizzle column references; no `${userInput}` appears in identifier positions.
3. **Bounded pagination** — `limit` and `offset` are hardened via `parseInt + Math.min/Math.max` before parameterization.
4. **Type-safe query builder elsewhere** — non-raw paths use `db.select()`, `db.insert()`, `db.update()`, `db.delete()` with `eq`, `and`, `inArray`, `gte`, `lte`, `isNull`. No string SQL.
5. **PostGIS queries safe** — the sole WKT cast is against a stored column, not user input; lat/lng coordinates are zod-validated numbers before parameterization.
6. **Migrations are static DDL** — auto-generated by drizzle-kit, no dynamic input.
7. **No search/filter string-SQL construction** — CSV-export filters use Drizzle's `gte/lte/eq` helpers; status/studentId CSV filters execute in JavaScript, not SQL.

**Overall SQL-injection posture: STRONG. No exploitable vulnerabilities. Two informational items (INFO-1, INFO-2) raised for defense-in-depth; neither describes an exploitable SQL-injection path.**
