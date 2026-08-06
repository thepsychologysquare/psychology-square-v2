-- The booking form now collects email and phone as two separate mandatory
-- fields instead of one combined "Email or phone" field.
-- Run once against your existing D1 database:
--   npx wrangler d1 execute psychology-square-bookings --remote --file=./migrations-2026-08-contact-email-phone.sql

ALTER TABLE bookings ADD COLUMN email TEXT NOT NULL DEFAULT '';
ALTER TABLE bookings ADD COLUMN phone TEXT NOT NULL DEFAULT '';

-- Backfill existing bookings from the old single "contact" field, best-effort:
-- if it looks like an email address it goes into email, otherwise it's
-- treated as a phone number. This only affects historical rows — every
-- booking submitted after this migration will always have both.
UPDATE bookings SET email = contact WHERE contact LIKE '%_@_%.__%';
UPDATE bookings SET phone = contact WHERE NOT (contact LIKE '%_@_%.__%');

-- The old "contact" column is intentionally left in place (the app no
-- longer reads or writes it) so no historical data is lost and nothing
-- else that might reference it breaks.
