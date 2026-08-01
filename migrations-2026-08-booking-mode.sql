-- Adds the online vs in-person session format to bookings.
-- Run once against your existing D1 database:
--   npx wrangler d1 execute psychology-square-bookings --remote --file=./migrations-2026-08-booking-mode.sql

ALTER TABLE bookings ADD COLUMN mode TEXT NOT NULL DEFAULT 'online'; -- 'online' | 'in_person'
