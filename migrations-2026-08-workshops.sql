-- Live, cohort-based workshops (via Google Meet). Distinct from Courses:
-- a course is self-paced content; a workshop is a group of people who all
-- pay in to the SAME session, which only runs once enough of them have
-- joined. Payment/review flow mirrors `bookings` (payment screenshot ->
-- admin approves/declines each person), with one addition: once enough
-- people are approved, an admin manually "confirms" the workshop, which
-- locks in a date/time + Google Meet link and emails everyone who's in.
--
-- Run once against your D1 database:
--   npx wrangler d1 execute psychology-square-bookings --remote --file=./migrations-2026-08-workshops.sql

CREATE TABLE IF NOT EXISTS workshops (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'general',
  instructor TEXT NOT NULL DEFAULT '',        -- 'sohail' | 'sehar'
  price_pkr INTEGER NOT NULL,
  min_seats INTEGER NOT NULL DEFAULT 6,       -- copied in at creation time from the sitewide default; how many APPROVED enrollments before an admin can confirm it
  max_seats INTEGER,                          -- null = uncapped
  image TEXT,
  image_alt TEXT,
  status TEXT NOT NULL DEFAULT 'open',        -- 'open' | 'confirmed' | 'cancelled' | 'completed'
  scheduled_at TEXT,                          -- set only once confirmed (free-text: admin types the date/time)
  meet_link TEXT,                             -- set only once confirmed
  draft INTEGER NOT NULL DEFAULT 1,           -- same review-before-public posture as courses
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workshops_status ON workshops (status, draft);

-- One row per person who has submitted payment for a workshop. Same shape
-- as `bookings` (screenshot review flow), scoped to a workshop instead of
-- a therapy slot -- there's no slot_id/clinician/mode here since a
-- workshop isn't tied to one clinician's calendar the way a session is.
CREATE TABLE IF NOT EXISTS workshop_enrollments (
  id TEXT PRIMARY KEY,                        -- reference code, e.g. TPS-W4F9A2
  workshop_slug TEXT NOT NULL REFERENCES workshops(slug) ON DELETE CASCADE,
  workshop_title TEXT NOT NULL,               -- captured at signup time so the row still reads fine if the workshop is edited/renamed later
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  notes TEXT,
  amount_pkr INTEGER NOT NULL,
  payment_method TEXT NOT NULL,
  screenshot_key TEXT NOT NULL,
  screenshot_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',     -- 'pending' | 'active' | 'declined'
  submitter_ip TEXT,
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  UNIQUE(workshop_slug, email)
);

CREATE INDEX IF NOT EXISTS idx_workshop_enrollments_workshop ON workshop_enrollments (workshop_slug, status);
CREATE INDEX IF NOT EXISTS idx_workshop_enrollments_status ON workshop_enrollments (status, created_at);
