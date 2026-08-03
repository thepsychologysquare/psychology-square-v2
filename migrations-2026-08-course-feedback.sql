-- Optional 3-question Likert feedback survey, shown once a learner passes
-- a course quiz. Entirely optional -- a learner can skip it, so rows only
-- exist for learners who chose to submit.
CREATE TABLE IF NOT EXISTS course_feedback (
  id TEXT PRIMARY KEY,
  course_slug TEXT NOT NULL,
  course_title TEXT NOT NULL,
  certificate_id TEXT,
  clarity_rating INTEGER NOT NULL,      -- 1-5: how clear was the content
  usefulness_rating INTEGER NOT NULL,   -- 1-5: how useful for their practice
  recommend_rating INTEGER NOT NULL,    -- 1-5: likelihood to recommend
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_course_feedback_course ON course_feedback (course_slug);
