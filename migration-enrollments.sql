CREATE TABLE IF NOT EXISTS magic_link_tokens (
  token TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  redirect_path TEXT,
  enroll_course_slug TEXT,
  enroll_name TEXT,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS enrollments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_slug TEXT NOT NULL,
  course_title TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  enrolled_at TEXT NOT NULL,
  UNIQUE(course_slug, email)
);

CREATE INDEX IF NOT EXISTS idx_enrollments_email ON enrollments (email);
CREATE INDEX IF NOT EXISTS idx_enrollments_course ON enrollments (course_slug);
