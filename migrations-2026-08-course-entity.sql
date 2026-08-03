-- Course Builder Studio, phase 2: the course ENTITY itself (title, slug,
-- description, category, image, pricing, quiz, publish state) now lives in
-- D1 instead of a Decap-authored markdown file in src/content/courses.
-- This is what finally lets a course be created and edited entirely from
-- /dashboard/courses — nothing to touch in Decap/git for a new course.
--
-- Additive + backward compatible:
--   - Existing Decap course files are left completely alone on disk.
--   - src/lib/courses.ts merges this table with the Decap `courses`
--     collection at read time: a row here overrides that course's
--     metadata, but if the course still has no rows in `course_modules`
--     the original markdown `body` keeps rendering as the legacy
--     single-page layout until you add modules in the Studio.
--   - The three courses that existed in Decap at the time of this
--     migration are copied in below (INSERT OR IGNORE) with their exact
--     current values, so nothing changes on the live site — they just
--     become editable from the dashboard from now on.
--
-- Run once against your D1 database:
--   npx wrangler d1 execute psychology-square-bookings --remote --file=./migrations-2026-08-course-entity.sql

CREATE TABLE IF NOT EXISTS courses (
  slug                 TEXT PRIMARY KEY,
  title                TEXT NOT NULL,
  description          TEXT NOT NULL DEFAULT '',
  category              TEXT NOT NULL DEFAULT 'general',
  estimated_hours       REAL NOT NULL DEFAULT 1,
  author                TEXT NOT NULL DEFAULT '',
  is_paid               INTEGER NOT NULL DEFAULT 0,
  price_pkr             INTEGER,
  pass_score_percent    INTEGER NOT NULL DEFAULT 80,
  quiz                  TEXT NOT NULL DEFAULT '[]',   -- JSON array: [{question, options[], correctIndex}]
  image                 TEXT,                          -- full URL, or /api/courses/image/<key> for uploads
  image_alt             TEXT,
  sort_order            INTEGER NOT NULL DEFAULT 0,
  draft                 INTEGER NOT NULL DEFAULT 1,
  source                TEXT NOT NULL DEFAULT 'studio', -- 'studio' (created here) | 'decap' (migrated from markdown)
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_courses_sort ON courses (sort_order);

-- The three courses already live in Decap at the time this ships. Their
-- values are copied verbatim from src/content/courses/*.md — the certificate
-- pass score, quiz questions, pricing, etc. are all unchanged.
INSERT OR IGNORE INTO courses (slug, title, description, category, estimated_hours, author, is_paid, price_pkr, pass_score_percent, quiz, image, image_alt, sort_order, draft, source, created_at, updated_at) VALUES ('cbt-fundamentals-for-clinicians', 'CBT Fundamentals for Clinicians', 'A practical refresher on core cognitive-behavioral therapy principles, thought records, and structuring a CBT session.', 'general', 1, 'Muhammad Sohail', 0, NULL, 80, '[{"question": "In CBT, the core model proposes that our emotional reactions are most directly shaped by:", "options": ["The situation itself, independent of interpretation", "Our thoughts and interpretations about a situation", "Childhood attachment style alone", "Physiological arousal preceding any thought"], "correctIndex": 1}, {"question": "A thought record primarily helps a client to:", "options": ["Suppress unwanted thoughts entirely", "Identify and test the evidence for and against an automatic thought", "Replace all negative thoughts with positive affirmations", "Avoid situations that trigger automatic thoughts"], "correctIndex": 1}, {"question": "Which of the following is a well-established cognitive distortion?", "options": ["Socratic questioning", "Behavioral activation", "Catastrophizing", "Psychoeducation"], "correctIndex": 2}, {"question": "A typical structured CBT session usually begins with:", "options": ["Free association with no set agenda", "A mood check-in and collaborative agenda-setting", "Homework review only, skipping agenda-setting", "A full diagnostic interview every session"], "correctIndex": 1}]', NULL, NULL, 0, 0, 'decap', '2026-08-02T00:00:00.000Z', '2026-08-02T00:00:00.000Z');
INSERT OR IGNORE INTO courses (slug, title, description, category, estimated_hours, author, is_paid, price_pkr, pass_score_percent, quiz, image, image_alt, sort_order, draft, source, created_at, updated_at) VALUES ('depression-decoded-a-complete-course-built-on-the-cipriani-et-al-2018-antidepressant-meta-analysis', 'Depression Decoded: A Complete Course Built on the Cipriani et al. (2018) Antidepressant Meta-Analysis', 'This entire course around one specific, real, and genuinely contestable meta-analysis: Cipriani, Furukawa, Salanti, et al., "Comparative efficacy and acceptability of 21 antidepressant drugs for the acute treatment of adults with major depressive disorder: a systematic review and network meta-analysis," published in The Lancet, 2018. It''s the largest, most cited, most methodologically ambitious depression meta-analysis ever done, and it has been directly, publicly, and substantively challenged by other scientists. ', 'depression', 1, 'Muhammad Sohail', 0, NULL, 80, '[{"question": "1. In Cipriani et al. (2018), what was the primary efficacy outcome measured at approximately 8 weeks?", "options": ["Complete remission on the HAM-D", "Response rate — proportion achieving ≥50% reduction on a depression rating scale", "Patient-reported quality of life score", "Time to relapse after treatment discontinuation"], "correctIndex": 0}]', 'https://plus.unsplash.com/premium_photo-1668062843172-0129f25a1276?q=80&w=870&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D', 'Woman in a depressive state', 0, 0, 'decap', '2026-08-02T00:00:00.000Z', '2026-08-02T00:00:00.000Z');
INSERT OR IGNORE INTO courses (slug, title, description, category, estimated_hours, author, is_paid, price_pkr, pass_score_percent, quiz, image, image_alt, sort_order, draft, source, created_at, updated_at) VALUES ('emotional-intelligence-eq-101', 'Emotional Intelligence (EQ) 101', 'This is a course on Emotinal Intelligence. ', 'general', 1, 'Muhammad Sohail', 0, NULL, 80, '[{"question": "What is the main benefit of expanding your emotional vocabulary (e.g., distinguishing between ''stressed'' and ''unsupported'')?", "options": ["It helps you convince others that you are right.", "It allows you to identify the root cause of an emotion and address it effectively.", "It prevents you from feeling negative emotions entirely.", "It speeds up your reaction time in high-stress situations."], "correctIndex": 1}, {"question": "You receive a critical email from a colleague that makes you feel defensive. According to self-regulation principles, what is the best immediate response?", "options": ["Immediately reply explaining why their critique is incorrect so they don''t get the wrong idea.", "Ignore the email completely to avoid confrontation.", "Pause for a short period before responding to let your logical brain engage.", "Forward the email to your manager to handle."], "correctIndex": 2}]', 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcSVfbC7-7OV5JCymZKzmCAiuP_YR_-l_Ers6Q0vwspKndQrG3gHIFBxvwyy&s=10', 'Emotional Intelligence', 0, 0, 'decap', '2026-08-02T00:00:00.000Z', '2026-08-02T00:00:00.000Z');
