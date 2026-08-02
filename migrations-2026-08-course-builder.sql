-- Course Builder: replaces Decap's flat, typed-slug "course-modules"
-- collection with a real hierarchy managed from /dashboard/courses.
-- Additive only — existing courses/enrollments/certificates tables are
-- untouched. A course with zero rows here just keeps using its old
-- Decap-based single-page layout (see courses/[slug].astro).
--
-- Run once against your D1 database:
--   npx wrangler d1 execute psychology-square-bookings --remote --file=./migrations-2026-08-course-builder.sql

CREATE TABLE IF NOT EXISTS course_modules (
  id TEXT PRIMARY KEY,
  course_slug TEXT NOT NULL,        -- matches the Decap course's slug/id
  title TEXT NOT NULL,
  sequence_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_course_modules_course ON course_modules (course_slug, sequence_order);

CREATE TABLE IF NOT EXISTS course_steps (
  id TEXT PRIMARY KEY,
  module_id TEXT NOT NULL REFERENCES course_modules(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'text',   -- 'text' | 'video'
  content_body TEXT,                            -- lesson text, or notes for a video
  video_url TEXT,                                -- embeddable URL, only for 'video'
  sequence_order INTEGER NOT NULL DEFAULT 0,
  question TEXT,                                 -- optional ungraded check-in question
  question_options TEXT,                         -- JSON array of strings
  question_correct_index INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_course_steps_module ON course_steps (module_id, sequence_order);

-- One row per (learner, step) they've marked complete. This is the piece
-- the old Decap-based module player never had — progress used to live
-- only in the browser tab and vanished on refresh.
CREATE TABLE IF NOT EXISTS step_completions (
  email TEXT NOT NULL,
  step_id TEXT NOT NULL REFERENCES course_steps(id) ON DELETE CASCADE,
  course_slug TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  PRIMARY KEY (email, step_id)
);

CREATE INDEX IF NOT EXISTS idx_step_completions_course ON step_completions (course_slug, email);
