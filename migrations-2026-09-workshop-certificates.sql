-- Workshop certificates: reuses the existing certificates table + certificate
-- page instead of adding new ones. Safe to run on your existing database --
-- only adds columns, nothing is changed or removed.
--   npx wrangler d1 execute psychology-square-bookings --remote --file=./migrations-2026-09-workshop-certificates.sql
--
-- RUN THIS BEFORE deploying the code that goes with it (the code selects
-- these columns).
--
-- certificates.kind: 'course' (every existing row, via the default) or
--   'workshop'. Only changes the wording on the certificate ("online
--   workshop" / "Workshop completed on") and how the dashboard/My
--   Certificates label the row.
-- workshop_enrollments.completed_at / certificate_id: set when you press
--   "Mark complete" on a Workshop Signups row. certificate_id is what stops
--   the same person being issued twice.
ALTER TABLE certificates ADD COLUMN kind TEXT NOT NULL DEFAULT 'course';
ALTER TABLE workshop_enrollments ADD COLUMN completed_at TEXT;
ALTER TABLE workshop_enrollments ADD COLUMN certificate_id TEXT;
