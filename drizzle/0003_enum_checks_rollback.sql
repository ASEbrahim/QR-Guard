-- Rollback for 0003_enum_checks.sql.
-- NOT AUTO-APPLIED by drizzle-kit. Run manually if you need to remove the
-- CHECK constraints added by 0003:
--
--   psql "$DATABASE_URL" -f drizzle/0003_enum_checks_rollback.sql
--
-- After rollback, also: git revert <the commit that added 0003>.
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_role_check";
ALTER TABLE "sessions" DROP CONSTRAINT IF EXISTS "sessions_status_check";
ALTER TABLE "attendance" DROP CONSTRAINT IF EXISTS "attendance_status_check";
ALTER TABLE "audit_log" DROP CONSTRAINT IF EXISTS "audit_log_event_type_check";
ALTER TABLE "audit_log" DROP CONSTRAINT IF EXISTS "audit_log_result_check";
ALTER TABLE "email_verification_tokens"
  DROP CONSTRAINT IF EXISTS "email_verification_tokens_purpose_check";
