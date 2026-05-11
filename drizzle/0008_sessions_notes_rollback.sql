-- Rollback for 0008_sessions_notes.sql
--
-- WARNING: this DROPs the column unconditionally, taking any saved notes
-- with it. If you need to keep notes content, export it before running:
--   COPY (SELECT session_id, notes FROM sessions WHERE notes IS NOT NULL)
--   TO '/tmp/session_notes_backup.csv' CSV HEADER;

ALTER TABLE "sessions" DROP COLUMN IF EXISTS "notes";
