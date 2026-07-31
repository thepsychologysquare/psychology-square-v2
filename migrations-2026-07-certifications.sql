-- Adds ONLY the new pieces needed for the CE certification system.
-- Safe to run on your existing database: doesn't touch anything that
-- already exists.
--   npx wrangler d1 execute psychology-square-bookings --remote --file=./migrations-2026-07-certifications.sql

-- One row per quiz submission, pass or fail, so we can see attempt history
-- and let people retake a course after a failed attempt.
CREATE TABLE IF NOT EXISTS course_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_slug TEXT NOT NULL,
  course_title TEXT NOT NULL,      -- snapshot at time of attempt
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  score_percent INTEGER NOT NULL,
  passed INTEGER NOT NULL,          -- 0 | 1
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_course_attempts_email ON course_attempts (email);
CREATE INDEX IF NOT EXISTS idx_course_attempts_course ON course_attempts (course_slug);

-- One row per issued certificate. Only created on a qualifying (passing)
-- attempt. The id itself (e.g. TPS-CERT-4F9A2) is the public, verifiable
-- reference — no login needed to look one up.
CREATE TABLE IF NOT EXISTS certificates (
  id TEXT PRIMARY KEY,
  course_slug TEXT NOT NULL,
  course_title TEXT NOT NULL,       -- snapshot, so this stays accurate even if the course content later changes
  ce_hours REAL NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  score_percent INTEGER NOT NULL,
  issued_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_certificates_email ON certificates (email);
CREATE INDEX IF NOT EXISTS idx_certificates_course ON certificates (course_slug);
