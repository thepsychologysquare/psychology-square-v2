// Single source of truth for workshop topics ("category" on the workshops
// table). Used by: the public /workshops listing (badge labels), the
// dashboard new/edit workshop forms (the Topic dropdown + "add a new topic"
// box), and the admin API's validation. Backed by the `workshop_categories`
// table (see migrations-2026-08-workshop-categories.sql) so the admin can
// add new topics from the dashboard without a code change or redeploy.

export interface WorkshopCategoryRow {
  value: string;
  label: string;
  sort_order: number;
  created_at: string;
}

// Used only if the table is missing or empty (e.g. before the migration
// has been run) so the app never ends up with an empty dropdown.
export const FALLBACK_WORKSHOP_CATEGORIES: WorkshopCategoryRow[] = [
  { value: 'general', label: 'General', sort_order: 0, created_at: '' },
  { value: 'anxiety', label: 'Anxiety', sort_order: 1, created_at: '' },
  { value: 'depression', label: 'Depression', sort_order: 2, created_at: '' },
  { value: 'adhd', label: 'ADHD', sort_order: 3, created_at: '' },
  { value: 'addiction-recovery', label: 'Addiction & Recovery', sort_order: 4, created_at: '' },
  { value: 'trauma', label: 'Trauma', sort_order: 5, created_at: '' },
  { value: 'relationships', label: 'Relationships', sort_order: 6, created_at: '' },
  { value: 'stress-burnout', label: 'Stress & Burnout', sort_order: 7, created_at: '' },
];

export function slugifyCategory(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

export async function listWorkshopCategories(env: any): Promise<WorkshopCategoryRow[]> {
  if (!env?.DB) return FALLBACK_WORKSHOP_CATEGORIES;
  const { results } = await env.DB.prepare(
    `SELECT value, label, sort_order, created_at FROM workshop_categories ORDER BY sort_order ASC, label ASC`
  ).all();
  const rows = results as WorkshopCategoryRow[];
  return rows.length ? rows : FALLBACK_WORKSHOP_CATEGORIES;
}

export async function categoryLabelMap(env: any): Promise<Record<string, string>> {
  const rows = await listWorkshopCategories(env);
  return Object.fromEntries(rows.map((r) => [r.value, r.label]));
}

/** Adds a new topic if it doesn't already exist (by slugified value); returns the row either way. */
export async function addWorkshopCategory(env: any, rawLabel: string): Promise<WorkshopCategoryRow> {
  const label = rawLabel.trim();
  if (!label) throw new Error('Please enter a topic name.');
  const value = slugifyCategory(label);
  if (!value) throw new Error('That topic name isn\'t valid — please use letters or numbers.');
  if (!env?.DB) throw new Error('Database unavailable.');

  const existing = await env.DB.prepare(
    `SELECT value, label, sort_order, created_at FROM workshop_categories WHERE value = ?`
  ).bind(value).first<WorkshopCategoryRow>();
  if (existing) return existing;

  const max = await env.DB.prepare(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM workshop_categories`).first<{ m: number }>();
  const now = new Date().toISOString();
  const sortOrder = (max?.m ?? -1) + 1;
  await env.DB.prepare(
    `INSERT INTO workshop_categories (value, label, sort_order, created_at) VALUES (?, ?, ?, ?)`
  ).bind(value, label, sortOrder, now).run();

  return { value, label, sort_order: sortOrder, created_at: now };
}

/** Validates a submitted category value against the current list, falling back to 'general'. */
export async function validateCategory(env: any, rawValue: string): Promise<string> {
  const value = String(rawValue || 'general').trim().toLowerCase();
  const rows = await listWorkshopCategories(env);
  return rows.some((r) => r.value === value) ? value : 'general';
}
