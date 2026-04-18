-- Migration 0004: at-most-one OPEN crossing per (course, student).
--
-- Problem: the existing PK (course_id, student_id, crossed_below_at)
-- permits two concurrent checkThresholdAndNotify() calls to both INSERT
-- because their `new Date()` values differ by milliseconds. Result: the
-- student receives duplicate warning emails on every race.
--
-- Fix: a partial UNIQUE index enforces that at most one row per
-- (course, student) can have recovered_above_at IS NULL. Historical
-- (recovered) rows remain unique by the original PK.
--
-- The application uses INSERT ... ON CONFLICT DO NOTHING against this
-- index to claim the crossing atomically, then sends the email. If the
-- email send fails, the row is deleted so the next call can retry.
--
-- Safety: DROP IF EXISTS first so the migration is re-runnable.
DROP INDEX IF EXISTS "warning_email_log_open_unique_idx";
--> statement-breakpoint
CREATE UNIQUE INDEX "warning_email_log_open_unique_idx"
  ON "warning_email_log" ("course_id", "student_id")
  WHERE "recovered_above_at" IS NULL;
