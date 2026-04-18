-- Rollback for 0004_warning_log_unique_open.sql
-- Run manually if you need to remove the partial unique index.
DROP INDEX IF EXISTS "warning_email_log_open_unique_idx";
