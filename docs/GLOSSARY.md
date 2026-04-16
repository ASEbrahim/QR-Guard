<!--
last_updated: 2026-04-16
audience: Claude Code (terminology lookup), maintainer (reference)
role: canonical definitions of every term used in QR-Guard
-->

# GLOSSARY.md

> Every term, acronym, and naming convention used in QR-Guard. When you encounter an unfamiliar term in the FRS, UML diagrams, or code — look it up here. If a term is missing, add it after using it for the first time.

---

## Acronyms

| Acronym | Expansion | Context |
|---|---|---|
| AUK | American University of Kuwait | The client institution |
| FRS | Functional Requirements Specification | The spec document at `docs/FRS.docx` |
| RTM | Requirements Traceability Matrix | Section 8 of the FRS |
| MVC | Model-View-Controller | The chosen architecture pattern (Ch06) |
| DFD | Data Flow Diagram | Notation used in `docs/uml/07-dfd-level-0` and `09-dfd-level-1` (NOT UML) |
| UML | Unified Modeling Language | Notation used for use case, sequence, activity, class, state machine, architecture |
| GPS | Global Positioning System | Source of student location data via browser Geolocation API |
| QR | Quick Response (code) | The 2D barcode displayed by instructor and scanned by student |
| IP | Internet Protocol (address) | Used for country verification via ip-api.com |
| VPN | Virtual Private Network | Detected by ip-api.com, results in scan rejection |
| PR | Progress Report | PR1 = proposal phase, PR2 = current milestone |
| SOLID | Single resp / Open-closed / Liskov / Interface seg / Dependency inv | Design principles enforced (Ch07) |
| COTS | Commercial Off-The-Shelf | Reused components (qrcode.js, bcrypt, etc.) — Ch02 |
| CMM | Capability Maturity Model | Process maturity scale (Ch02) |
| TDD | Test-Driven Development | Test-influenced approach used here (Ch08) |
| V&V | Verification & Validation | Quality assurance approach (Ch08) |
| QA | Quality Assurance | Process-oriented quality (Ch01) |
| QC | Quality Control | Product-oriented quality (Ch01) |
| WBS | Work Breakdown Structure | Project decomposition (Ch04) |
| NFR | Non-Functional Requirement | Performance, security, etc. (FRS §5) |
| FR | Functional Requirement | What the system does (FRS §3) |

---

## Domain terms

| Term | Definition |
|---|---|
| **Geofence** | A circular area defined by a center coordinate (lat, lng) and radius (meters) within which a scan is accepted. Per FRS, includes a +15m indoor margin. |
| **Session** | A single class period for a course. Has a start time, end time, and active QR token cycle. |
| **Attendance window** | The time interval during which scans are accepted for a session. Default: 5 minutes. Configurable per course. |
| **QR refresh interval** | How often a new QR token is generated and pushed to the instructor's display. Default: 25 seconds. |
| **Warning threshold** | The attendance percentage below which a warning email fires. Default: 85%. |
| **Single-use per refresh cycle** | A given QR token can only be successfully scanned once per student per refresh cycle. Rescans return "Already recorded." |
| **Device binding** | Each student account is tied to one browser fingerprint (FingerprintJS visitor ID). One bind per semester, re-bind via verified email. |
| **Audit log** | Append-only record of every scan attempt (success or failure) with full context (GPS, IP, accuracy, device hash, result, reason). |
| **Override** | Instructor manually changes a student's attendance status for a session, with required reason. Logged to audit log. |
| **Excused** | An attendance status (alongside present/absent) for sessions excluded from the percentage denominator. |
| **Enrollment code** | 6-character alphanumeric code used by students to self-enroll in a course. |
| **Scan pipeline** | The 6-layer verification sequence run on every scan attempt. See `docs/uml/02-sequence-scan.svg`. |

---

## Naming conventions

### Files

| Type | Convention | Example |
|---|---|---|
| Class file | kebab-case matching class name | `ScanVerifier` → `scan-verifier.js` |
| Test file | source name + `.test.js` | `scan-verifier.test.js` |
| Route handler | `<resource>-routes.js` | `auth-routes.js`, `scan-routes.js` |
| Controller | `<resource>-controller.js` | `course-controller.js` |
| Service | `<service-name>-service.js` | `email-service.js`, `ip-api-service.js` |
| Validator (pipeline) | `<check>-checker.js` or `<check>-validator.js` | `geofence-checker.js`, `qr-validator.js` |
| DB schema | `<table>.schema.js` (singular) | `user.schema.js`, `attendance.schema.js` |

### Code

| What | Convention | Example |
|---|---|---|
| Class | PascalCase | `ScanVerifier`, `AuditLog` |
| Function | camelCase, verb-first | `validateQrToken()`, `recordAttendance()` |
| Constant | SCREAMING_SNAKE_CASE | `QR_REFRESH_INTERVAL_MS`, `BCRYPT_ROUNDS` |
| Boolean | `is`/`has`/`should` prefix | `isWithinGeofence`, `hasValidDevice` |
| Private member | leading underscore | `_internalCache` |
| Async function | suffix not required, but type clearly returns Promise | `verifyDeviceFingerprint()` |
| DB column | snake_case | `university_id`, `device_fingerprint`, `created_at` |
| API endpoint | kebab-case, RESTful | `POST /api/scan`, `GET /api/courses/:id/students` |

### Status / enum values

Use lowercase strings with hyphens, not symbols or numbers.
- ✅ `'present'`, `'absent'`, `'excused'`, `'pending'`
- ❌ `'PRESENT'`, `'STATUS_1'`, `1`, `true`/`false` for tri-state

---

## Validator names (the 6-layer pipeline)

These are the canonical names used in code, tests, and the architecture diagram. **Do not invent variants.**

| Layer | Class name | Responsibility |
|---|---|---|
| 1 | `QrValidator` | Validate QR token against current refresh cycle |
| 2 | `DeviceChecker` | Match scanned device fingerprint against stored binding |
| 3 | `IpValidator` | Call ip-api.com, check country = Kuwait + no VPN/proxy |
| 4 | `GpsAccuracyChecker` | Reject if accuracy > 150m or === 0 |
| 5 | `GeofenceChecker` | PostGIS ST_DWithin against course geofence + 15m margin |
| 6 | `AuditLogger` | Append every attempt (success or failure) to audit log |

The orchestrator that runs all 6 in order is `ScanVerifier`.

---

## Status codes (HTTP responses)

| Code | When |
|---|---|
| `200` | Successful read or operation |
| `201` | Resource created (registration, course, session) |
| `400` | Validation failure (bad input, missing field) |
| `401` | Not authenticated (no/invalid session) |
| `403` | Authenticated but not authorized (wrong role) OR scan rejected for verification reason |
| `404` | Resource not found |
| `409` | Conflict (duplicate enrollment, duplicate scan) |
| `429` | Rate limit (5+ failed login attempts) |
| `500` | Server error (log it, return generic message to client) |

For scan rejections specifically, use `403` with a JSON body containing `{ reason: 'qr_expired' | 'device_mismatch' | 'location_failed' | 'outside_geofence' | 'already_recorded', message: 'human-readable string' }`.

---

## Time units

Always specify units in variable names to prevent ambiguity.

- ✅ `qrRefreshIntervalMs`, `attendanceWindowSeconds`, `tokenExpirySeconds`
- ❌ `qrRefresh`, `window`, `expiry`

DB columns store timestamps as `timestamptz` (PostgreSQL), always UTC. Convert to local time for display only.
