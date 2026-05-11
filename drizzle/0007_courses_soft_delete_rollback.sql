-- Rollback for 0007_courses_soft_delete.sql
--
-- Reverts the soft-delete column, the partial index, and reverts the
-- audit_log.event_type CHECK to its prior 3-value set.
--
-- WARNING: any audit rows with event_type='course_deleted' must be
-- removed or remapped BEFORE running this rollback, otherwise the
-- recreated CHECK will fail. The DELETE below handles that.

DELETE FROM "audit_log" WHERE "event_type" = 'course_deleted';
--> statement-breakpoint

ALTER TABLE "audit_log" DROP CONSTRAINT IF EXISTS "audit_log_event_type_check";
--> statement-breakpoint

ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_event_type_check"
  CHECK ("event_type" IN ('scan_attempt', 'override', 'auth'));
--> statement-breakpoint

DROP INDEX IF EXISTS "courses_instructor_active_idx";
--> statement-breakpoint

ALTER TABLE "courses" DROP COLUMN IF EXISTS "deleted_at";
