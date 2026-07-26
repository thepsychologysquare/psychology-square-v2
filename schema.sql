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

-- One recurring weekly schedule per clinician. Saved once; the availability
-- API keeps generating open slots from it automatically going forward.
CREATE TABLE IF NOT EXISTS weekly_templates (
  clinician TEXT PRIMARY KEY,        -- 'sohail' | 'sehar'
  days TEXT NOT NULL,                -- JSON array of working weekdays, 0=Sun..6=Sat
  start_time TEXT NOT NULL,          -- 'HH:MM' (24h)
  end_time TEXT NOT NULL,            -- 'HH:MM' (24h)
  slot_minutes INTEGER NOT NULL DEFAULT 60,
  updated_at TEXT NOT NULL
);

-- One-off dates marked off even though they'd normally be a working day
-- per the weekly template (e.g. a single Friday off for a holiday).
CREATE TABLE IF NOT EXISTS availability_exceptions (
  clinician TEXT NOT NULL,
  date TEXT NOT NULL,                -- 'YYYY-MM-DD'
  PRIMARY KEY (clinician, date)
);
