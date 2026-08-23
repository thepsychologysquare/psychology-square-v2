-- Adds SEO/marketing columns to the Studio-managed `courses` table so a
-- course created entirely from /dashboard/courses can carry the same
-- public curriculum/FAQ content that drives the improved course-page SEO
-- (see src/pages/courses/[slug].astro). Additive only — every column has
-- a safe default, so existing rows and the read path in src/lib/courses.ts
-- keep working untouched for any course that hasn't set these yet.
--
-- Run once against your D1 database:
--   npx wrangler d1 execute psychology-square-bookings --remote --file=./migrations-2026-08-course-seo-fields.sql

ALTER TABLE courses ADD COLUMN seo_title TEXT;
ALTER TABLE courses ADD COLUMN keywords TEXT NOT NULL DEFAULT '[]';          -- JSON array of strings
ALTER TABLE courses ADD COLUMN what_youll_learn TEXT NOT NULL DEFAULT '[]';  -- JSON array of strings
ALTER TABLE courses ADD COLUMN faqs TEXT NOT NULL DEFAULT '[]';              -- JSON array: [{question, answer}]
ALTER TABLE courses ADD COLUMN level TEXT NOT NULL DEFAULT 'all-levels';     -- beginner | intermediate | advanced | all-levels
