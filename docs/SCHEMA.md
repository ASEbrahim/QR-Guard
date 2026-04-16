<!--
last_updated: 2026-04-16
verified_against: class diagram (docs/uml/04-class-diagram.svg) and FRS v1.1
audience: Claude Code (DB implementation), maintainer (review)
role: canonical PostgreSQL schema for QR-Guard
-->

# SCHEMA.md

> The PostgreSQL schema for QR-Guard. Derived from the class diagram (`docs/uml/04-class-diagram.svg`). When implementing Inc 1 onwards, use Drizzle to define this schema; never deviate from the structure here without updating both this doc and the class diagram.

---

## Extensions required

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";
```

PostGIS is required for `GeofenceChecker` (uses `ST_DWithin`).

---

## Tables

### `users`

The base user table — both students and instructors. `role` discriminates.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `user_id` | `uuid` | PRIMARY KEY, default `uuid_generate_v4()` | |
| `email` | `text` | UNIQUE, NOT NULL | Must end in `@auk.edu.kw` (validated app-side) |
| `password_hash` | `text` | NOT NULL | bcrypt, 12 rounds |
| `name` | `text` | NOT NULL | |
| `role` | `text` | NOT NULL, CHECK in (`'student'`, `'instructor'`) | |
| `email_verified_at` | `timestamptz` | NULL | Set when verification link clicked |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | |
| `failed_login_count` | `integer` | NOT NULL, default `0` | Reset on successful login |
| `locked_until` | `timestamptz` | NULL | Set when failed_login_count hits 5 |

### `students`

Student-specific fields. One-to-one with `users` where `role = 'student'`.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `user_id` | `uuid` | PRIMARY KEY, REFERENCES `users(user_id)` ON DELETE CASCADE | |
| `university_id` | `text` | UNIQUE, NOT NULL | e.g., `57488` |
| `device_fingerprint` | `text` | NULL | FingerprintJS visitor ID; null until first login |
| `device_bound_at` | `timestamptz` | NULL | Set when device_fingerprint is set |

### `instructors`

Instructor-specific fields. One-to-one with `users` where `role = 'instructor'`.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `user_id` | `uuid` | PRIMARY KEY, REFERENCES `users(user_id)` ON DELETE CASCADE | |
| `employee_id` | `text` | UNIQUE, NOT NULL | |

### `courses`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `course_id` | `uuid` | PRIMARY KEY, default `uuid_generate_v4()` | |
| `instructor_id` | `uuid` | NOT NULL, REFERENCES `instructors(user_id)` | |
| `name` | `text` | NOT NULL | e.g., `Software Engineering` |
| `code` | `text` | NOT NULL | e.g., `CSIS 330` |
| `section` | `text` | NOT NULL | e.g., `01` |
| `semester` | `text` | NOT NULL | e.g., `Spring 2026` |
| `enrollment_code` | `text` | UNIQUE, NOT NULL | 6-char alphanumeric |
| `geofence_center` | `geography(Point, 4326)` | NOT NULL | PostGIS point |
| `geofence_radius_m` | `integer` | NOT NULL, CHECK between 10 and 500 | |
| `attendance_window_seconds` | `integer` | NOT NULL, default `300` | 5 min default |
| `warning_threshold_pct` | `numeric(5,2)` | NOT NULL, default `85.00` | |
| `qr_refresh_interval_seconds` | `integer` | NOT NULL, default `25` | |
| `weekly_schedule` | `jsonb` | NOT NULL | `[{day: 'mon', start: '09:00', end: '10:15'}, ...]` |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | |

**Index:** `CREATE INDEX courses_instructor_idx ON courses(instructor_id);`

### `enrollments`

Many-to-many between students and courses.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `course_id` | `uuid` | REFERENCES `courses(course_id)` ON DELETE CASCADE | |
| `student_id` | `uuid` | REFERENCES `students(user_id)` ON DELETE CASCADE | |
| `enrolled_at` | `timestamptz` | NOT NULL, default `now()` | |
| `removed_at` | `timestamptz` | NULL | Soft-delete; historical records retained |

**Primary key:** `(course_id, student_id)`

### `sessions`

A class session for a course.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `session_id` | `uuid` | PRIMARY KEY, default `uuid_generate_v4()` | |
| `course_id` | `uuid` | NOT NULL, REFERENCES `courses(course_id)` ON DELETE CASCADE | |
| `scheduled_start` | `timestamptz` | NOT NULL | From weekly_schedule or ad-hoc |
| `scheduled_end` | `timestamptz` | NOT NULL | |
| `actual_start` | `timestamptz` | NULL | Set when instructor clicks "Start" |
| `actual_end` | `timestamptz` | NULL | Set when stopped or window expires |
| `status` | `text` | NOT NULL, default `'scheduled'`, CHECK in (`'scheduled'`, `'active'`, `'closed'`, `'cancelled'`) | |
| `created_at` | `timestamptz` | NOT NULL, default `now()` | |

**Index:** `CREATE INDEX sessions_course_idx ON sessions(course_id, scheduled_start);`

### `qr_tokens`

A single QR token in a session's lifecycle.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `token_id` | `uuid` | PRIMARY KEY, default `uuid_generate_v4()` | |
| `session_id` | `uuid` | NOT NULL, REFERENCES `sessions(session_id)` ON DELETE CASCADE | |
| `payload` | `text` | NOT NULL, UNIQUE | Base64-encoded payload |
| `generated_at` | `timestamptz` | NOT NULL, default `now()` | |
| `expires_at` | `timestamptz` | NOT NULL | `generated_at + qr_refresh_interval_seconds` |

**Index:** `CREATE INDEX qr_tokens_session_idx ON qr_tokens(session_id, generated_at DESC);`

### `attendance`

The persistent record of a student's attendance for a session.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `attendance_id` | `uuid` | PRIMARY KEY, default `uuid_generate_v4()` | |
| `session_id` | `uuid` | NOT NULL, REFERENCES `sessions(session_id)` | |
| `student_id` | `uuid` | NOT NULL, REFERENCES `students(user_id)` | |
| `status` | `text` | NOT NULL, CHECK in (`'present'`, `'absent'`, `'excused'`) | |
| `recorded_at` | `timestamptz` | NOT NULL, default `now()` | |
| `gps_lat` | `numeric(10,7)` | NULL | NULL for absent/excused |
| `gps_lng` | `numeric(10,7)` | NULL | |
| `gps_accuracy_m` | `numeric(8,2)` | NULL | |
| `ip_address` | `inet` | NULL | |
| `device_hash` | `text` | NULL | FingerprintJS visitor ID at scan time |
| `excuse_reason` | `text` | NULL | Required when status = 'excused' |

**Unique constraint:** `(session_id, student_id)` — one record per student per session
**Index:** `CREATE INDEX attendance_student_idx ON attendance(student_id);`

### `audit_log`

Append-only log of every scan attempt + every override.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `log_id` | `uuid` | PRIMARY KEY, default `uuid_generate_v4()` | |
| `timestamp` | `timestamptz` | NOT NULL, default `now()` | |
| `event_type` | `text` | NOT NULL, CHECK in (`'scan_attempt'`, `'override'`, `'auth'`) | |
| `actor_id` | `uuid` | NULL, REFERENCES `users(user_id)` | NULL if unauthenticated |
| `target_id` | `uuid` | NULL | Session ID for scan, student ID for override |
| `result` | `text` | NOT NULL, CHECK in (`'success'`, `'rejected'`) | |
| `reason` | `text` | NULL | `'qr_expired'`, `'device_mismatch'`, `'location_failed'`, `'outside_geofence'`, `'already_recorded'`, `'override_present'`, `'override_absent'`, `'override_excused'` |
| `details` | `jsonb` | NULL | Full context: GPS, IP, accuracy, device hash, old/new status |

**Index:** `CREATE INDEX audit_log_timestamp_idx ON audit_log(timestamp DESC);`
**Index:** `CREATE INDEX audit_log_actor_idx ON audit_log(actor_id);`

**Trigger:** Reject UPDATE and DELETE on this table at the DB level (append-only):

```sql
CREATE OR REPLACE FUNCTION reject_audit_log_modify() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION reject_audit_log_modify();
CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION reject_audit_log_modify();
```

### `email_verification_tokens`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `token` | `text` | PRIMARY KEY | Random 64-char hex |
| `user_id` | `uuid` | NOT NULL, REFERENCES `users(user_id)` ON DELETE CASCADE | |
| `purpose` | `text` | NOT NULL, CHECK in (`'email_verify'`, `'password_reset'`, `'device_rebind'`) | |
| `expires_at` | `timestamptz` | NOT NULL | 24h for verify, 1h for reset/rebind |
| `used_at` | `timestamptz` | NULL | Set on first use; subsequent uses rejected |

### `warning_email_log`

Tracks which warning emails have been sent to prevent duplicate sends per crossing.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `course_id` | `uuid` | REFERENCES `courses(course_id)` ON DELETE CASCADE | |
| `student_id` | `uuid` | REFERENCES `students(user_id)` ON DELETE CASCADE | |
| `crossed_below_at` | `timestamptz` | NOT NULL | |
| `recovered_above_at` | `timestamptz` | NULL | |

**Primary key:** `(course_id, student_id, crossed_below_at)`

A new warning fires only when there is no row with `recovered_above_at IS NULL` for this (course, student).

---

## Helper queries

### Compute attendance % for one student in one course

```sql
SELECT
  COUNT(*) FILTER (WHERE a.status = 'present') * 100.0
  / NULLIF(COUNT(*) FILTER (WHERE a.status IN ('present', 'absent')), 0)
  AS attendance_pct
FROM sessions s
LEFT JOIN attendance a
  ON a.session_id = s.session_id
  AND a.student_id = $1
WHERE s.course_id = $2
  AND s.status = 'closed';
```

### Geofence check (used by GeofenceChecker)

```sql
SELECT ST_DWithin(
  c.geofence_center,
  ST_SetSRID(ST_MakePoint($lng, $lat), 4326)::geography,
  c.geofence_radius_m + 15  -- +15m indoor margin per FR4.3
) AS within
FROM courses c
WHERE c.course_id = $courseId;
```

---

## Migration order

When Drizzle generates the migration, the order must be:

1. Extensions (`uuid-ossp`, `postgis`)
2. `users`
3. `students`, `instructors` (depend on `users`)
4. `courses` (depends on `instructors`)
5. `enrollments`, `sessions` (depend on `courses` and `students`)
6. `qr_tokens` (depends on `sessions`)
7. `attendance` (depends on `sessions`, `students`)
8. `audit_log`, `email_verification_tokens`, `warning_email_log`
9. Indexes
10. Triggers (audit_log append-only)
