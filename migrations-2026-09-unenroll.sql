-- Adds "unenroll from an in-progress course" support. Additive only.
-- Unenrolling is a status change, not a delete: the row (and its lesson
-- progress / past quiz attempts) stays, status flips to 'unenrolled', and
-- unenrolled_at records when. Re-enrolling reactivates the same row.
--
-- Run once against your D1 database:
--   npx wrangler d1 execute psychology-square-bookings --remote --file=./migrations-2026-09-unenroll.sql

ALTER TABLE enrollments ADD COLUMN unenrolled_at TEXT;
