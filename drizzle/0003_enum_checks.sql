-- Migration 0003: DB-level CHECK constraints on every enum column.
--
-- Rationale: Drizzle's `text('col', { enum: [...] })` enforces allowed values
-- in the TypeScript/JavaScript layer ONLY. Any raw SQL path (db.execute with
-- a literal, a future microservice sharing the DB, a manual INSERT during
-- ops) can bypass it. Adding CHECK constraints at the database makes the
-- invariant load-bearing for every writer.
--
-- Naming: <table>_<column>_check — matches PostgreSQL's default suggestion
-- when a table constraint is auto-named. Safe to DROP by name for rollback
-- (see 0003_enum_checks_rollback.sql).
--
-- Safety: each constraint is added with DROP ... IF EXISTS first so the
-- migration is re-runnable. Existing app-layer enforcement means no data
-- should violate these; if it does, the ALTER fails and we investigate.
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_role_check";
ALTER TABLE "users" ADD CONSTRAINT "users_role_check"
  CHECK ("role" IN ('student', 'instructor'));
--> statement-breakpoint

ALTER TABLE "sessions" DROP CONSTRAINT IF EXISTS "sessions_status_check";
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_status_check"
  CHECK ("status" IN ('scheduled', 'active', 'closed', 'cancelled'));
--> statement-breakpoint

ALTER TABLE "attendance" DROP CONSTRAINT IF EXISTS "attendance_status_check";
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_status_check"
  CHECK ("status" IN ('present', 'absent', 'excused'));
--> statement-breakpoint

ALTER TABLE "audit_log" DROP CONSTRAINT IF EXISTS "audit_log_event_type_check";
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_event_type_check"
  CHECK ("event_type" IN ('scan_attempt', 'override', 'auth'));
--> statement-breakpoint

ALTER TABLE "audit_log" DROP CONSTRAINT IF EXISTS "audit_log_result_check";
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_result_check"
  CHECK ("result" IN ('success', 'rejected'));
--> statement-breakpoint

ALTER TABLE "email_verification_tokens"
  DROP CONSTRAINT IF EXISTS "email_verification_tokens_purpose_check";
ALTER TABLE "email_verification_tokens"
  ADD CONSTRAINT "email_verification_tokens_purpose_check"
  CHECK ("purpose" IN ('email_verify', 'password_reset', 'device_rebind'));
