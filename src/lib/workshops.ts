// Data access for live, cohort-based workshops -- see
// migrations-2026-08-workshops.sql for the two tables this touches
// (`workshops`, `workshop_enrollments`). Deliberately separate from
// src/lib/courses.ts: a workshop has no modules/steps, no per-learner
// progress, and its enrollment flow is single-shot payment-proof review
// (like a booking), not the courses' free-enroll-or-pay split.

export const WORKSHOP_MIN_SEATS_DEFAULT = 6; // same number for every workshop, per how these are run today

export interface WorkshopRow {
  slug: string;
  title: string;
  description: string;
  category: string;
  instructor: string;
  price_pkr: number;
  min_seats: number;
  max_seats: number | null;
  image: string | null;
  image_alt: string | null;
  details: string; // long-form "Workshop details" copy shown below the image on the public page -- see migrations-2026-08-workshop-details.sql
  status: 'open' | 'confirmed' | 'cancelled' | 'completed'; // legacy — publish/unpublish is via `draft` now; status stays 'open'
  scheduled_at: string | null; // free-text "tentative date & time", set manually by the admin, not gated on enrollment count
  meet_link: string | null; // unused for now — sent manually to enrollees once a time is settled
  draft: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface WorkshopEnrollmentRow {
  id: string;
  workshop_slug: string;
  workshop_title: string;
  name: string;
  email: string;
  phone: string;
  notes: string | null;
  amount_pkr: number;
  payment_method: string;
  screenshot_key: string;
  screenshot_type: string;
  status: 'pending' | 'active' | 'declined';
  submitter_ip: string | null;
  created_at: string;
  reviewed_at: string | null;
}

export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .trim()
      .replace(/['"]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 90) || `workshop-${Date.now()}`
  );
}

export async function generateUniqueSlug(env: any, title: string): Promise<string> {
  const base = slugify(title);
  let slug = base;
  let i = 2;
  while (await env.DB.prepare(`SELECT slug FROM workshops WHERE slug = ?`).bind(slug).first()) {
    slug = `${base}-${i++}`;
  }
  return slug;
}

/** Public listing: published (non-draft) workshops that are still open or already confirmed -- not cancelled/completed. */
export async function listPublicWorkshops(env: any): Promise<(WorkshopRow & { activeCount: number })[]> {
  if (!env?.DB) return [];
  const { results } = await env.DB.prepare(
    `SELECT w.*, COALESCE(a.n, 0) AS activeCount
     FROM workshops w
     LEFT JOIN (SELECT workshop_slug, COUNT(*) AS n FROM workshop_enrollments WHERE status = 'active' GROUP BY workshop_slug) a
       ON a.workshop_slug = w.slug
     WHERE w.draft = 0 AND w.status IN ('open', 'confirmed')
     ORDER BY w.sort_order ASC, w.created_at DESC`
  ).all();
  return results as (WorkshopRow & { activeCount: number })[];
}

/** Admin listing: everything, regardless of draft/status. */
export async function listAllWorkshops(env: any): Promise<(WorkshopRow & { activeCount: number; pendingCount: number })[]> {
  if (!env?.DB) return [];
  const { results } = await env.DB.prepare(
    `SELECT w.*,
            COALESCE(a.n, 0) AS activeCount,
            COALESCE(p.n, 0) AS pendingCount
     FROM workshops w
     LEFT JOIN (SELECT workshop_slug, COUNT(*) AS n FROM workshop_enrollments WHERE status = 'active' GROUP BY workshop_slug) a
       ON a.workshop_slug = w.slug
     LEFT JOIN (SELECT workshop_slug, COUNT(*) AS n FROM workshop_enrollments WHERE status = 'pending' GROUP BY workshop_slug) p
       ON p.workshop_slug = w.slug
     ORDER BY w.sort_order ASC, w.created_at DESC`
  ).all();
  return results as (WorkshopRow & { activeCount: number; pendingCount: number })[];
}

export async function getWorkshopBySlug(env: any, slug: string): Promise<WorkshopRow | undefined> {
  if (!env?.DB) return undefined;
  const row = await env.DB.prepare(`SELECT * FROM workshops WHERE slug = ?`).bind(slug).first();
  return (row as WorkshopRow) || undefined;
}

export async function countActiveEnrollments(env: any, slug: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM workshop_enrollments WHERE workshop_slug = ? AND status = 'active'`
  ).bind(slug).first<{ n: number }>();
  return row?.n ?? 0;
}

export interface WorkshopInput {
  title: string;
  description: string;
  category: string;
  instructor: string;
  pricePkr: number;
  minSeats?: number;
  maxSeats?: number | null;
  image?: string | null;
  imageAlt?: string | null;
  scheduledAt?: string | null;
  details?: string;
  draft: boolean;
}

export async function createWorkshop(env: any, slug: string, input: WorkshopInput): Promise<void> {
  const now = new Date().toISOString();
  const max = await env.DB.prepare(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM workshops`).first<{ m: number }>();
  await env.DB.prepare(
    `INSERT INTO workshops
      (slug, title, description, category, instructor, price_pkr, min_seats, max_seats, image, image_alt, status, scheduled_at, details, draft, sort_order, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?)`
  ).bind(
    slug,
    input.title,
    input.description || '',
    input.category || 'general',
    input.instructor || '',
    input.pricePkr,
    input.minSeats ?? WORKSHOP_MIN_SEATS_DEFAULT,
    input.maxSeats ?? null,
    input.image ?? null,
    input.imageAlt ?? null,
    input.scheduledAt ?? null,
    input.details ?? '',
    input.draft ? 1 : 0,
    (max?.m ?? -1) + 1,
    now,
    now
  ).run();
}

export async function updateWorkshop(env: any, slug: string, patch: Record<string, any>): Promise<void> {
  const columnMap: Record<string, string> = {
    title: 'title',
    description: 'description',
    category: 'category',
    instructor: 'instructor',
    pricePkr: 'price_pkr',
    minSeats: 'min_seats',
    maxSeats: 'max_seats',
    image: 'image',
    imageAlt: 'image_alt',
    draft: 'draft',
    status: 'status',
    scheduledAt: 'scheduled_at',
    meetLink: 'meet_link',
    details: 'details',
  };
  const fields: Record<string, any> = {};
  for (const [key, col] of Object.entries(columnMap)) {
    if (!(key in patch)) continue;
    let value = patch[key];
    if (key === 'draft') value = value ? 1 : 0;
    fields[col] = value;
  }
  if (Object.keys(fields).length === 0) return;
  fields.updated_at = new Date().toISOString();

  const setClause = Object.keys(fields).map((k) => `${k} = ?`).join(', ');
  await env.DB.prepare(`UPDATE workshops SET ${setClause} WHERE slug = ?`)
    .bind(...Object.values(fields), slug)
    .run();
}

/** Deletes a workshop and everything tied to it (enrollments; screenshots are cleaned up by the caller, which has the R2 binding). */
export async function deleteWorkshop(env: any, slug: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM workshop_enrollments WHERE workshop_slug = ?`).bind(slug),
    env.DB.prepare(`DELETE FROM workshops WHERE slug = ?`).bind(slug),
  ]);
}
