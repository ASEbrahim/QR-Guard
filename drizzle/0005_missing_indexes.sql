-- Migration 0005: indexes that were documented-as-added but actually missing.
--
-- audit_log_target_idx (P1-13): `getAuditLog` filters WHERE target_id IN (...)
-- over all sessions of a course. Without this index it's a seq-scan of an
-- ever-growing append-only table. SCHEMA.md line 170 claimed this index
-- existed; prior audit's SESSION_REPORT_FULL.md line 109 listed it among
-- the Round 3 fixes. Neither the Drizzle schema nor any migration had it.
--
-- courses_instructor_idx (P1-14): listCourses for an instructor filters by
-- instructor_id. SCHEMA.md line 84 claimed this index existed; it did not.
--
-- enrollments_student_idx (P1-15): the PRIMARY KEY on (course_id,
-- student_id) can serve queries starting with course_id but NOT
-- student_id-only lookups (Socket.IO canAccessSession, getMyAttendance,
-- listCourses student branch). Seq-scan today. A plain index on student_id
-- alone is needed.
--
-- IF NOT EXISTS on every CREATE INDEX so the migration is re-runnable.
CREATE INDEX IF NOT EXISTS "audit_log_target_idx"
  ON "audit_log" ("target_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "courses_instructor_idx"
  ON "courses" ("instructor_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "enrollments_student_idx"
  ON "enrollments" ("student_id");
