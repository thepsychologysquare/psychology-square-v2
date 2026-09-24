-- Adds a third lesson type, 'pdf', alongside the existing 'text' and
-- 'video' content_type values on course_steps.
ALTER TABLE course_steps ADD COLUMN pdf_url TEXT;
