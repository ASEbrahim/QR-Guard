# Sprint B — Dynamic QR & Scan Pipeline

**Spec source:** INCREMENTS.md § Inc 3
**FRS sections:** FR3.1–FR3.6, FR4.1–FR4.10
**Dependencies:** Sprint A (auth, courses, sessions, device binding all working)

---

## Scope confirmation

This sprint delivers the core QR-Guard value: instructor starts a session, a dynamic QR code appears and refreshes every 25 seconds via Socket.IO, students scan it through their phone camera, and the server runs a 6-layer fail-fast verification pipeline (QR validity → device fingerprint → IP country → GPS accuracy → geofence → audit log) before recording attendance. Every scan attempt — success or failure — is logged to an append-only audit log. The instructor sees a live counter of checked-in students. The student gets a specific error message per failure layer.

---

## Out of scope

- Reports, CSV export (Sprint C)
- Warning emails, threshold notifications (Sprint C)
- Override / excuse absence (Sprint C)
- Rate limiting, security headers (Sprint C)
- Bulk QR for hybrid sessions
- Bluetooth proximity verification
- Multi-device backup scanning

---

## Architecture decisions

### Geofence query: WKT text → geography cast

Sprint A stores geofence_center as a WKT text string (e.g., `SRID=4326;POINT(47.9835 29.3117)`) because Drizzle doesn't support native PostGIS geography columns. The GeofenceChecker must cast it in the query:

```sql
SELECT ST_DWithin(
  ST_GeogFromText(geofence_center),
  ST_SetSRID(ST_MakePoint($lng, $lat), 4326)::geography,
  geofence_radius_m + 15
) AS within
FROM courses
WHERE course_id = $courseId
```

This is raw SQL via `db.execute(sql`...`)`, not Drizzle query builder. The +15 is the indoor margin from `GEOFENCE_INDOOR_MARGIN_M`.

### ip-api.com fail policy: FAIL-OPEN

If ip-api.com times out (3-second timeout) or returns an error, the scan **proceeds** (not rejected). The failure is logged to the audit log with `reason: 'ip_check_skipped'` so the instructor can see it. Rationale: rejecting students because of an external API problem is worse than letting one spoofed scan through.

### ip-api.com rate awareness

ip-api.com free tier: 45 requests/minute. For a class of 30 students scanning over a 5-minute window, that's ~30 requests — well within limits. No rate-limit handling needed for MVP. If it becomes an issue, responses are cached by IP for 60 seconds.

### Socket.IO namespace strategy

One namespace per active session: `/session-{sessionId}`. The instructor joins on session start, students join on scan page load. Events:
- Server → clients: `qr:refresh` (new QR payload), `attendance:update` (live count), `session:closed`
- Client → server: `join` (with session ID)

Socket connections are authenticated via the same express-session cookie (shared middleware).

### QR payload format

```json
Base64({
  "sessionId": "uuid",
  "ts": 1713300000000,
  "lat": 29.3117,
  "lng": 47.9835,
  "r": 100
})
```

`ts` is the generation timestamp. Token validity = `ts` within current refresh window. Embedding geofence in the payload prevents replay attacks from a different location.

### Single-use enforcement

Per (student, session). One attendance row per student per session (UNIQUE constraint on attendance table). A student who scans twice in the same session gets "Already recorded" — regardless of which refresh cycle.

### Audit log append-only enforcement

DB triggers that reject UPDATE and DELETE on the `audit_log` table. Applied via migration SQL.

---

## Data model changes

### New tables (from SCHEMA.md)

**qr_tokens**
| Column | Type | Constraints |
|---|---|---|
| token_id | uuid | PK, default gen_random_uuid() |
| session_id | uuid | NOT NULL, FK sessions(session_id) ON DELETE CASCADE |
| payload | text | NOT NULL, UNIQUE |
| generated_at | timestamptz | NOT NULL, default now() |
| expires_at | timestamptz | NOT NULL |

Index: `qr_tokens(session_id, generated_at DESC)`

**attendance**
| Column | Type | Constraints |
|---|---|---|
| attendance_id | uuid | PK, default gen_random_uuid() |
| session_id | uuid | NOT NULL, FK sessions(session_id) |
| student_id | uuid | NOT NULL, FK students(user_id) |
| status | text | NOT NULL, CHECK ('present','absent','excused') |
| recorded_at | timestamptz | NOT NULL, default now() |
| gps_lat | numeric(10,7) | NULL |
| gps_lng | numeric(10,7) | NULL |
| gps_accuracy_m | numeric(8,2) | NULL |
| ip_address | text | NULL |
| device_hash | text | NULL |
| excuse_reason | text | NULL |

UNIQUE: (session_id, student_id)
Index: `attendance(student_id)`

**audit_log**
| Column | Type | Constraints |
|---|---|---|
| log_id | uuid | PK, default gen_random_uuid() |
| timestamp | timestamptz | NOT NULL, default now() |
| event_type | text | NOT NULL, CHECK ('scan_attempt','override','auth') |
| actor_id | uuid | NULL, FK users(user_id) |
| target_id | uuid | NULL |
| result | text | NOT NULL, CHECK ('success','rejected') |
| reason | text | NULL |
| details | jsonb | NULL |

Index: `audit_log(timestamp DESC)`, `audit_log(actor_id)`
Trigger: reject UPDATE/DELETE (append-only)

---

## API surface

### Session control — `src/backend/routes/session-routes.js`

| Method | Path | Auth | Body/Params | Success | Errors |
|---|---|---|---|---|---|
| POST | `/api/sessions/:id/start` | instructor (course owner) | — | 200 `{qrPayload, expiresAt}` | 400 (already active), 403, 404 |
| POST | `/api/sessions/:id/stop` | instructor (course owner) | — | 200 `{message}` | 403, 404 |
| GET | `/api/sessions/:id/qr` | any auth'd | — | 200 `{qrPayload, expiresAt}` | 404 (no active token) |

### Scan — `src/backend/routes/scan-routes.js`

| Method | Path | Auth | Body | Success | Errors |
|---|---|---|---|---|---|
| POST | `/api/scan` | student | `{qrPayload, gpsLat, gpsLng, gpsAccuracy, deviceFingerprint}` | 200 `{message: "Attendance recorded"}` | 403 + reason code |

Scan rejection response shape:
```json
{
  "error": "QR expired — wait for refresh",
  "code": "qr_expired"
}
```

Reason codes: `qr_expired`, `device_mismatch`, `location_failed`, `gps_accuracy_failed`, `outside_geofence`, `already_recorded`

---

## File-level plan

### New dependencies
```
socket.io          — WebSocket server
qrcode             — QR code generation (toDataURL for instructor display)
html5-qrcode       — camera QR scanning (CDN, frontend only)
```

### Backend — new files
```
src/backend/db/schema/qr-token.schema.js       (new) Drizzle schema: qr_tokens
src/backend/db/schema/attendance.schema.js      (new) Drizzle schema: attendance
src/backend/db/schema/audit-log.schema.js       (new) Drizzle schema: audit_log
src/backend/db/schema/index.js                  (modify) re-export new schemas

src/backend/validators/qr-validator.js          (new) Layer 1: token valid for current cycle
src/backend/validators/device-checker.js        (new) Layer 2: fingerprint matches binding
src/backend/validators/ip-validator.js          (new) Layer 3: ip-api.com country + VPN check
src/backend/validators/gps-accuracy-checker.js  (new) Layer 4: accuracy ≤ 150m and ≠ 0
src/backend/validators/geofence-checker.js      (new) Layer 5: PostGIS ST_DWithin with WKT cast
src/backend/validators/audit-logger.js          (new) Layer 6: append to audit_log (always runs)
src/backend/validators/scan-verifier.js         (new) Orchestrator: runs 1-5, short-circuits, 6 in finally

src/backend/routes/session-routes.js            (new) /api/sessions/:id/start, stop, qr
src/backend/routes/scan-routes.js               (new) /api/scan
src/backend/controllers/session-controller.js   (new) Start/stop session, QR generation loop
src/backend/controllers/scan-controller.js      (new) Receives scan, delegates to ScanVerifier
src/backend/services/qr-service.js              (new) QR token creation, refresh loop management
src/backend/services/socket-service.js          (new) Socket.IO setup, namespace management

src/backend/server.js                           (modify) mount new routes, attach Socket.IO
src/backend/config/constants.js                 (modify) add scan pipeline constants
```

### Migration
```
drizzle/0001_sprint_b.sql                       (new) qr_tokens, attendance, audit_log + triggers
```

### Frontend — new files
```
src/frontend/instructor/session.html            (new) Full-screen QR, live counter, stop button
src/frontend/student/scan.html                  (new) Camera, GPS request, scan UI, result
```

### Tests
```
src/backend/validators/qr-validator.test.js          (new) happy + expired + malformed
src/backend/validators/device-checker.test.js        (new) happy + mismatch + no binding
src/backend/validators/ip-validator.test.js          (new) happy + VPN + non-Kuwait + API timeout
src/backend/validators/gps-accuracy-checker.test.js  (new) happy + > 150m + === 0
src/backend/validators/geofence-checker.test.js      (new) happy + outside + boundary
src/backend/validators/scan-verifier.test.js         (new) full pipeline order (spies), short-circuit
tests/integration/scan-flow.test.js                  (new) end-to-end scan with test DB
```

### Doc updates
```
docs/STATE.md                                   (modify) mark Sprint B complete
docs/CODEBASE_MAP.md                            (modify) add all new files
docs/SCHEMA.md                                  (modify) add qr_tokens, attendance, audit_log
```

---

## The 6-layer pipeline — implementation detail

```
scan-verifier.js orchestrator pseudocode:

async function verify(scanData) {
  let result = { success: false, reason: null };

  try {
    // Layer 1: QR token validity
    const token = await qrValidator.validate(scanData.qrPayload);
    // token contains sessionId, geofence data

    // Layer 2: device fingerprint
    await deviceChecker.check(scanData.studentId, scanData.deviceFingerprint);

    // Layer 3: IP country + VPN (FAIL-OPEN)
    await ipValidator.check(scanData.clientIp);

    // Layer 4: GPS accuracy
    gpsAccuracyChecker.check(scanData.gpsAccuracy);

    // Layer 5: geofence
    await geofenceChecker.check(
      token.courseId,
      scanData.gpsLat,
      scanData.gpsLng
    );
    // Uses: ST_DWithin(ST_GeogFromText(geofence_center), ST_SetSRID(ST_MakePoint($lng,$lat),4326)::geography, radius+15)

    // All passed — record attendance
    result = { success: true };

  } catch (err) {
    result = { success: false, reason: err.code, message: err.message };
  } finally {
    // Layer 6: ALWAYS log
    await auditLogger.log({
      eventType: 'scan_attempt',
      actorId: scanData.studentId,
      targetId: token?.sessionId,
      result: result.success ? 'success' : 'rejected',
      reason: result.reason,
      details: scanData,
    });
  }

  return result;
}
```

Each validator throws a `ScanError` with a `code` property on failure. The orchestrator catches it, extracts the code, and returns the appropriate error response.

---

## Test plan

| # | AC (from INCREMENTS.md) | Test |
|---|---|---|
| 1 | QR refreshes every 25 sec | integration: start session, wait, verify new token in DB + socket event |
| 2 | HTTP polling fallback | integration: GET /api/sessions/:id/qr returns current token |
| 3 | Valid scan records in ≤3 sec | integration: full scan with mocked ip-api, assert 200 + attendance row |
| 4 | Rescan returns "Already recorded" | integration: scan twice → 200 then 409 |
| 5 | Expired QR rejected | unit: qr-validator with expired timestamp → throws qr_expired |
| 6 | Wrong device rejected | unit: device-checker with mismatched hash → throws device_mismatch |
| 7 | VPN/wrong country rejected | unit: ip-validator mock returning country≠Kuwait → throws location_failed |
| 8 | Bad GPS accuracy rejected | unit: gps-accuracy-checker with 0 and 200 → throws gps_accuracy_failed |
| 9 | Outside geofence rejected | integration: geofence-checker with coords 1km away → throws outside_geofence |
| 10 | Every attempt logged | integration: successful + failed scans → audit_log rows with correct data |
| 11 | Pipeline order enforced | unit: scan-verifier with spies, fail at layer 1 → layers 2-5 never called |
| 12 | Live counter updates | integration: Socket.IO client receives attendance:update after scan |
| 13 | Manual stop closes session | integration: POST stop → status='closed', subsequent scans rejected |
| 14 | 60 concurrent scans | integration: Promise.all(60 scans), all succeed, no duplicate rows |

---

## Checkpoint commit strategy

1. **Commit 1:** `chore(sprint-b): add scan pipeline dependencies + DB migration`
   - New npm packages, migration SQL, schema files. No business logic.
2. **Commit 2:** `feat(sprint-b): dynamic QR + 6-layer scan pipeline`
   - All validators, controllers, routes, Socket.IO, frontend, tests, doc updates.
3. **Fresh DB migration test** after Commit 2:
   - Drop qrguard DB, recreate, run both migrations (0000 + 0001) in order, verify all tables + triggers exist.

---

## Acceptance criteria check

- [ ] AC 1: QR visibly refreshes every 25 sec
- [ ] AC 2: HTTP polling fallback within 10 sec of WebSocket disconnect
- [ ] AC 3: Valid scan records attendance in ≤3 sec
- [ ] AC 4: Rescan returns "Already recorded"
- [ ] AC 5: Expired QR → "QR expired — wait for refresh"
- [ ] AC 6: Different device → "Device not recognized"
- [ ] AC 7: VPN/wrong country → "Location verification failed"
- [ ] AC 8: GPS accuracy 0 or >150m → "Location verification failed"
- [ ] AC 9: Outside geofence → "Outside classroom area"
- [ ] AC 10: Every attempt creates audit log row
- [ ] AC 11: Pipeline order: cheapest first, fail-fast
- [ ] AC 12: Live counter updates in real-time
- [ ] AC 13: Manual stop rejects subsequent scans
- [ ] AC 14: 60 concurrent scans, no errors, no duplicates
