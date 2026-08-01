-- Run once against your D1 database:
--   npx wrangler d1 execute psychology-square-bookings --remote --file=./schema.sql

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,               -- short reference code shown to the client, e.g. TPS-4F9A2
  created_at TEXT NOT NULL,          -- ISO timestamp
  client_name TEXT NOT NULL,
  contact TEXT NOT NULL,             -- email or phone, whichever they gave
  service TEXT NOT NULL,             -- 'individual' | 'couples'
  clinician TEXT NOT NULL,           -- 'sohail' | 'sehar' | 'no-preference'
  preferred_time TEXT NOT NULL,      -- free-text slot the client typed/picked
  notes TEXT,                        -- optional message from the client
  amount_pkr INTEGER NOT NULL,
  payment_method TEXT NOT NULL,      -- 'easypaisa' | 'jazzcash' | 'bank'
  screenshot_key TEXT NOT NULL,      -- R2 object key for the uploaded proof
  screenshot_type TEXT NOT NULL,     -- content-type, for serving it back correctly
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'confirmed' | 'declined'
  submitter_ip TEXT                  -- used only for rate-limiting, not shown in the UI
);

CREATE INDEX IF NOT EXISTS idx_bookings_created_at ON bookings (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings (status);
CREATE INDEX IF NOT EXISTS idx_bookings_ip_time ON bookings (submitter_ip, created_at);

-- Slots each clinician opens up for booking. Clients can only pick from
-- slots that are 'open'; booking one flips it to 'booked'.
CREATE TABLE IF NOT EXISTS availability_slots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clinician TEXT NOT NULL,        -- 'sohail' | 'sehar'
  date TEXT NOT NULL,             -- 'YYYY-MM-DD'
  time TEXT NOT NULL,             -- 'HH:MM' (24h)
  status TEXT NOT NULL DEFAULT 'open'  -- 'open' | 'booked'
);

CREATE INDEX IF NOT EXISTS idx_slots_clinician_date ON availability_slots (clinician, date, time);
CREATE INDEX IF NOT EXISTS idx_slots_status ON availability_slots (status);

ALTER TABLE bookings ADD COLUMN slot_id INTEGER;

-- Legacy: one recurring weekly schedule per clinician, same hours every
-- selected day. Superseded by weekly_template_days below (kept so old
-- deployments migrate cleanly; the app no longer reads/writes this table).
CREATE TABLE IF NOT EXISTS weekly_templates (
  clinician TEXT PRIMARY KEY,        -- 'sohail' | 'sehar'
  days TEXT NOT NULL,                -- JSON array of working weekdays, 0=Sun..6=Sat
  start_time TEXT NOT NULL,          -- 'HH:MM' (24h)
  end_time TEXT NOT NULL,            -- 'HH:MM' (24h)
  slot_minutes INTEGER NOT NULL DEFAULT 60,
  updated_at TEXT NOT NULL
);

-- One row per (clinician, weekday) that's turned on — lets each day of the
-- week have its own hours (e.g. Mon-Fri evenings, Sat-Sun afternoons).
-- A day with no row is simply not worked.
CREATE TABLE IF NOT EXISTS weekly_template_days (
  clinician TEXT NOT NULL,
  day INTEGER NOT NULL,              -- 0=Sun..6=Sat
  start_time TEXT NOT NULL,          -- 'HH:MM' (24h)
  end_time TEXT NOT NULL,            -- 'HH:MM' (24h)
  slot_minutes INTEGER NOT NULL DEFAULT 60,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (clinician, day)
);

-- One-off per-clinician settings. Currently just the buffer clinicians want
-- left open between consecutive sessions (in minutes, 0 = back-to-back).
CREATE TABLE IF NOT EXISTS clinician_settings (
  clinician TEXT PRIMARY KEY,
  buffer_minutes INTEGER NOT NULL DEFAULT 0
);

-- Best-effort one-time migration from the old single-row template into the
-- new per-day shape. Safe to re-run: it only fires while the old row still
-- exists and a per-day row for that clinician doesn't yet.
INSERT INTO weekly_template_days (clinician, day, start_time, end_time, slot_minutes, updated_at)
SELECT wt.clinician, d.value AS day, wt.start_time, wt.end_time, wt.slot_minutes, wt.updated_at
FROM weekly_templates wt, json_each(wt.days) d
WHERE NOT EXISTS (
  SELECT 1 FROM weekly_template_days wtd WHERE wtd.clinician = wt.clinician
);

-- One-off dates marked off even though they'd normally be a working day
-- per the weekly template (e.g. a single Friday off for a holiday).
CREATE TABLE IF NOT EXISTS availability_exceptions (
  clinician TEXT NOT NULL,
  date TEXT NOT NULL,                -- 'YYYY-MM-DD'
  PRIMARY KEY (clinician, date)
);

-- CE certification system. See migrations-2026-07-certifications.sql for
-- the standalone migration if you're applying this to an existing DB.

-- One row per quiz submission, pass or fail.
CREATE TABLE IF NOT EXISTS course_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_slug TEXT NOT NULL,
  course_title TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  score_percent INTEGER NOT NULL,
  passed INTEGER NOT NULL,          -- 0 | 1
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_course_attempts_email ON course_attempts (email);
CREATE INDEX IF NOT EXISTS idx_course_attempts_course ON course_attempts (course_slug);

-- One row per issued certificate — created only on a qualifying attempt.
-- The id is the public, verifiable reference (e.g. TPS-CERT-4F9A2).
CREATE TABLE IF NOT EXISTS certificates (
  id TEXT PRIMARY KEY,
  course_slug TEXT NOT NULL,
  course_title TEXT NOT NULL,
  ce_hours REAL NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  score_percent INTEGER NOT NULL,
  issued_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_certificates_email ON certificates (email);
CREATE INDEX IF NOT EXISTS idx_certificates_course ON certificates (course_slug);

-- Passwordless login tokens. Previously stored in KV, which is only
-- *eventually* consistent across Cloudflare's edge locations — a token
-- written by one request could briefly be invisible to a read from a
-- different location, which is the most likely cause of magic links
-- intermittently failing ("expired") right after being issued. D1 has a
-- single consistent primary, so a token is reliably visible the instant
-- it's written.
CREATE TABLE IF NOT EXISTS magic_link_tokens (
  token TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  redirect_path TEXT,          -- where to send them after verifying (e.g. back to a course)
  enroll_course_slug TEXT,     -- if this login was to enroll in a course, which one
  enroll_name TEXT,            -- name given at the enroll form, for the enrollment record
  expires_at TEXT NOT NULL
);

-- One row per person enrolled in a course. Enrolling is what unlocks the
-- lesson content and quiz on that course's page.
CREATE TABLE IF NOT EXISTS enrollments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_slug TEXT NOT NULL,
  course_title TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  enrolled_at TEXT NOT NULL,
  UNIQUE(course_slug, email)
);

CREATE INDEX IF NOT EXISTS idx_enrollments_email ON enrollments (email);
CREATE INDEX IF NOT EXISTS idx_enrollments_course ON enrollments (course_slug);
