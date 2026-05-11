-- Migration 0008: Sessions notes
--
-- Adds sessions.notes for instructor-attached context per session
-- (e.g. "midterm", "guest lecture", "fire drill at 11:30"). Pure additive
-- nullable column; no constraints, no index (free-text not searched).

ALTER TABLE "sessions" ADD COLUMN IF NOT EXISTS "notes" TEXT;
