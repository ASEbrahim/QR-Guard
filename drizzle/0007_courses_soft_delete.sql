-- Migration 0007: Soft-delete for courses
--
-- Adds courses.deleted_at and expands the audit_log.event_type CHECK to
-- include 'course_deleted'. All course SELECT queries should filter
-- WHERE deleted_at IS NULL going forward; historical attendance, audit
-- log, and warning_email_log rows remain intact so transcripts can still
-- be queried even after a soft-delete.

ALTER TABLE "courses" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ;
--> statement-breakpoint

-- Composite partial index so the instructor dashboard's "my live courses"
-- query stays fast even with many soft-deleted rows in the table.
CREATE INDEX IF NOT EXISTS "courses_instructor_active_idx"
  ON "courses" ("instructor_id")
  WHERE "deleted_at" IS NULL;
--> statement-breakpoint

ALTER TABLE "audit_log" DROP CONSTRAINT IF EXISTS "audit_log_event_type_check";
--> statement-breakpoint

ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_event_type_check"
  CHECK ("event_type" IN ('scan_attempt', 'override', 'auth', 'course_deleted'));
