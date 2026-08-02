-- Phase 2-6 additions: paid-course enrollment (payment proof + admin review),
-- and moderated Q&A. Additive only — nothing here touches existing rows or
-- columns; a free course or an already-active enrollment behaves exactly as
-- it does today.
--
-- Run once against your D1 database:
--   npx wrangler d1 execute psychology-square-bookings --remote --file=./migrations-2026-08-paid-courses-and-qa.sql

-- Free-course enrollments are created already-active, same as today. A
-- paid course now inserts a 'pending' row at payment-proof time instead,
-- which the admin dashboard flips to 'active' or 'declined'.
ALTER TABLE enrollments ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE enrollments ADD COLUMN amount_pkr INTEGER;
ALTER TABLE enrollments ADD COLUMN payment_method TEXT;
ALTER TABLE enrollments ADD COLUMN screenshot_key TEXT;
ALTER TABLE enrollments ADD COLUMN screenshot_type TEXT;
ALTER TABLE enrollments ADD COLUMN payment_submitted_at TEXT;
ALTER TABLE enrollments ADD COLUMN reviewed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_enrollments_status ON enrollments (status);

-- Moderated Q&A: a learner submits a question against a course (optionally
-- tied to a specific step); it stays invisible to everyone else until an
-- admin/clinician answers and publishes it. No open/live comment thread.
CREATE TABLE IF NOT EXISTS course_questions (
  id TEXT PRIMARY KEY,
  course_slug TEXT NOT NULL,
  course_title TEXT NOT NULL,
  step_id TEXT,                       -- optional: which step this was asked from
  step_title TEXT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT,
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'published' | 'declined'
  created_at TEXT NOT NULL,
  answered_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_course_questions_course ON course_questions (course_slug, status);
CREATE INDEX IF NOT EXISTS idx_course_questions_status ON course_questions (status, created_at);
