-- Fully removes the 3 courses (entity + content + all learner data) so
-- these slugs can be recreated fresh from the dashboard.
-- Confirmed safe to run: no real learners/certificates on these 3 courses.

-- 1. Anything hanging off course_steps (via their module) for these courses
DELETE FROM course_steps
WHERE module_id IN (
  SELECT id FROM course_modules WHERE course_slug IN (
    'cbt-fundamentals-for-clinicians',
    'depression-decoded-a-complete-course-built-on-the-cipriani-et-al-2018-antidepressant-meta-analysis',
    'emotional-intelligence-eq-101'
  )
);

-- 2. The modules themselves
DELETE FROM course_modules WHERE course_slug IN (
  'cbt-fundamentals-for-clinicians',
  'depression-decoded-a-complete-course-built-on-the-cipriani-et-al-2018-antidepressant-meta-analysis',
  'emotional-intelligence-eq-101'
);

-- 3. Learner progress / attempts / certificates / questions tied to these courses
DELETE FROM step_completions WHERE course_slug IN (
  'cbt-fundamentals-for-clinicians',
  'depression-decoded-a-complete-course-built-on-the-cipriani-et-al-2018-antidepressant-meta-analysis',
  'emotional-intelligence-eq-101'
);

DELETE FROM course_attempts WHERE course_slug IN (
  'cbt-fundamentals-for-clinicians',
  'depression-decoded-a-complete-course-built-on-the-cipriani-et-al-2018-antidepressant-meta-analysis',
  'emotional-intelligence-eq-101'
);

DELETE FROM certificates WHERE course_slug IN (
  'cbt-fundamentals-for-clinicians',
  'depression-decoded-a-complete-course-built-on-the-cipriani-et-al-2018-antidepressant-meta-analysis',
  'emotional-intelligence-eq-101'
);

DELETE FROM course_questions WHERE course_slug IN (
  'cbt-fundamentals-for-clinicians',
  'depression-decoded-a-complete-course-built-on-the-cipriani-et-al-2018-antidepressant-meta-analysis',
  'emotional-intelligence-eq-101'
);

DELETE FROM enrollments WHERE course_slug IN (
  'cbt-fundamentals-for-clinicians',
  'depression-decoded-a-complete-course-built-on-the-cipriani-et-al-2018-antidepressant-meta-analysis',
  'emotional-intelligence-eq-101'
);

-- 4. The course entity itself
DELETE FROM courses WHERE slug IN (
  'cbt-fundamentals-for-clinicians',
  'depression-decoded-a-complete-course-built-on-the-cipriani-et-al-2018-antidepressant-meta-analysis',
  'emotional-intelligence-eq-101'
);
