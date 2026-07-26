-- Adds ONLY the new pieces needed for per-day availability + session buffers.
-- Safe to run on your existing database: doesn't touch anything that
-- already exists, and skips the already-applied ALTER TABLE that caused
-- the "duplicate column name: slot_id" error.

CREATE TABLE IF NOT EXISTS weekly_template_days (
  clinician TEXT NOT NULL,
  day INTEGER NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  slot_minutes INTEGER NOT NULL DEFAULT 60,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (clinician, day)
);

CREATE TABLE IF NOT EXISTS clinician_settings (
  clinician TEXT PRIMARY KEY,
  buffer_minutes INTEGER NOT NULL DEFAULT 0
);

INSERT INTO weekly_template_days (clinician, day, start_time, end_time, slot_minutes, updated_at)
SELECT wt.clinician, d.value AS day, wt.start_time, wt.end_time, wt.slot_minutes, wt.updated_at
FROM weekly_templates wt, json_each(wt.days) d
WHERE NOT EXISTS (
  SELECT 1 FROM weekly_template_days wtd WHERE wtd.clinician = wt.clinician
);
