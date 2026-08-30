// Single source of truth for course topics ("category" on the courses
// table). Used by: the dashboard new/edit course forms (the Topic dropdown
// + "add a new topic" box) and the admin API's validation. Backed by the
// `course_categories` table (see migrations-2026-08-course-categories.sql)
// so the admin can add new topics from the dashboard without a code change
// or redeploy. Mirrors workshopCategories.ts.

export interface CourseCategoryRow {
  value: string;
  label: string;
  sort_order: number;
  created_at: string;
}

// Used only if the table is missing or empty (e.g. before the migration
// has been run) so the app never ends up with an empty dropdown.
export const FALLBACK_COURSE_CATEGORIES: CourseCategoryRow[] = [
  { value: 'general', label: 'General', sort_order: 0, created_at: '' },
  { value: 'anxiety', label: 'Anxiety', sort_order: 1, created_at: '' },
  { value: 'depression', label: 'Depression', sort_order: 2, created_at: '' },
  { value: 'adhd', label: 'ADHD', sort_order: 3, created_at: '' },
  { value: 'addiction-recovery', label: 'Addiction & Recovery', sort_order: 4, created_at: '' },
  { value: 'trauma', label: 'Trauma', sort_order: 5, created_at: '' },
  { value: 'relationships', label: 'Relationships', sort_order: 6, created_at: '' },
  { value: 'stress-burnout', label: 'Stress & Burnout', sort_order: 7, created_at: '' },
];

export function slugifyCourseCategory(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export async function listCourseCategories(env: any): Promise<CourseCategoryRow[]> {
  if (!env?.DB) return FALLBACK_COURSE_CATEGORIES;
  const { results } = await env.DB.prepare(
    `SELECT value, label, sort_order, created_at FROM course_categories ORDER BY sort_order ASC, label ASC`
  ).all();
  const rows = results as CourseCategoryRow[];
  return rows.length ? rows : FALLBACK_COURSE_CATEGORIES;
}

export async function courseCategoryLabelMap(env: any): Promise<Record<string, string>> {
  const rows = await listCourseCategories(env);
  return Object.fromEntries(rows.map((r) => [r.value, r.label]));
}

/** Adds a new topic if it doesn't already exist (by slugified value); returns the row either way. */
export async function addCourseCategory(env: any, rawLabel: string): Promise<CourseCategoryRow> {
  const label = rawLabel.trim();
  if (!label) throw new Error('Please enter a topic name.');
  const value = slugifyCourseCategory(label);
  if (!value) throw new Error('That topic name isn\'t valid — please use letters or numbers.');
  if (!env?.DB) throw new Error('Database unavailable.');

  const existing = await env.DB.prepare(
    `SELECT value, label, sort_order, created_at FROM course_categories WHERE value = ?`
  ).bind(value).first<CourseCategoryRow>();
  if (existing) return existing;

  const max = await env.DB.prepare(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM course_categories`).first<{ m: number }>();
  const now = new Date().toISOString();
  const sortOrder = (max?.m ?? -1) + 1;
  await env.DB.prepare(
    `INSERT INTO course_categories (value, label, sort_order, created_at) VALUES (?, ?, ?, ?)`
  ).bind(value, label, sortOrder, now).run();

  return { value, label, sort_order: sortOrder, created_at: now };
}

/** Validates a submitted category value against the current list, falling back to 'general'. */
export async function validateCourseCategory(env: any, rawValue: string): Promise<string> {
  const value = String(rawValue || 'general').trim().toLowerCase();
  const rows = await listCourseCategories(env);
  return rows.some((r) => r.value === value) ? value : 'general';
}
