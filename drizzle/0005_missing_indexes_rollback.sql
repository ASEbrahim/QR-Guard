-- Rollback for 0005_missing_indexes.sql
-- Run manually if you need to drop the indexes.
DROP INDEX IF EXISTS "audit_log_target_idx";
DROP INDEX IF EXISTS "courses_instructor_idx";
DROP INDEX IF EXISTS "enrollments_student_idx";
