-- Lets the admin add new workshop topics from the dashboard instead of the
-- list being hardcoded in the app. Seeded with the topics that were
-- previously hardcoded so nothing changes for existing workshops.

CREATE TABLE IF NOT EXISTS workshop_categories (
  value TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

INSERT OR IGNORE INTO workshop_categories (value, label, sort_order, created_at) VALUES
  ('general', 'General', 0, '2026-08-24T00:00:00.000Z'),
  ('anxiety', 'Anxiety', 1, '2026-08-24T00:00:00.000Z'),
  ('depression', 'Depression', 2, '2026-08-24T00:00:00.000Z'),
  ('adhd', 'ADHD', 3, '2026-08-24T00:00:00.000Z'),
  ('addiction-recovery', 'Addiction & Recovery', 4, '2026-08-24T00:00:00.000Z'),
  ('trauma', 'Trauma', 5, '2026-08-24T00:00:00.000Z'),
  ('relationships', 'Relationships', 6, '2026-08-24T00:00:00.000Z'),
  ('stress-burnout', 'Stress & Burnout', 7, '2026-08-24T00:00:00.000Z');
