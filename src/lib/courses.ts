// Unified course-entity data layer.
//
// Historically a course's metadata (title, slug, description, category,
// image, pricing, quiz...) lived only in a Decap-authored markdown file
// under src/content/courses. That's what made every new course a
// git-commit-and-wait-for-a-rebuild affair. This file makes the D1
// `courses` table the primary source of truth going forward, while
// staying 100% backward compatible with any course that hasn't been
// touched since:
//
//   - A slug with a row in D1  -> metadata comes from D1.
//   - A slug with no D1 row    -> metadata comes from the Decap collection,
//                                 completely unchanged.
//   - A slug with BOTH        -> D1 wins for metadata, but the original
//                                 Decap entry object (body/rendered) is kept
//                                 so the legacy single-page layout can still
//                                 call `render()` on it if the course has no
//                                 modules yet.
//
// Every function here returns objects shaped exactly like a
// `CollectionEntry<'courses'>` (`{ id, data, body, collection }`) so call
// sites elsewhere in the app don't need to change beyond swapping their
// import.

export interface CourseData {
  title: string;
  description: string;
  category: string;
  estimatedHours: number;
  author: string;
  isPaid: boolean;
  pricePkr?: number;
  passScorePercent: number;
  quiz: { question: string; options: string[]; correctIndex: number }[];
  image?: string;
  imageAlt?: string;
  order: number;
  draft: boolean;
}

export interface CourseEntry {
  id: string;
  data: CourseData;
  body?: string;
  collection?: 'courses';
  render?: unknown;
  rendered?: unknown;
}

interface CourseRow {
  slug: string;
  title: string;
  description: string;
  category: string;
  estimated_hours: number;
  author: string;
  is_paid: number;
  price_pkr: number | null;
  pass_score_percent: number;
  quiz: string;
  image: string | null;
  image_alt: string | null;
  sort_order: number;
  draft: number;
  source: string;
  created_at: string;
  updated_at: string;
}

function rowToData(row: CourseRow): CourseData {
  let quiz: CourseData['quiz'] = [];
  try {
    quiz = JSON.parse(row.quiz || '[]');
  } catch {
    quiz = [];
  }
  return {
    title: row.title,
    description: row.description,
    category: row.category,
    estimatedHours: row.estimated_hours,
    author: row.author,
    isPaid: !!row.is_paid,
    pricePkr: row.price_pkr ?? undefined,
    passScorePercent: row.pass_score_percent,
    quiz,
    image: row.image ?? undefined,
    imageAlt: row.image_alt ?? undefined,
    order: row.sort_order,
    draft: !!row.draft,
  };
}

async function getDecapEntry(slug: string): Promise<CourseEntry | undefined> {
  try {
    const { getEntry } = await import('astro:content');
    const entry = await getEntry('courses', slug);
    return entry as unknown as CourseEntry | undefined;
  } catch {
    return undefined;
  }
}

async function getAllDecapEntries(): Promise<CourseEntry[]> {
  try {
    const { getCollection } = await import('astro:content');
    const entries = await getCollection('courses');
    return entries as unknown as CourseEntry[];
  } catch {
    return [];
  }
}

/** Fetch one course by slug, merging D1 (if present) over the Decap entry (if present). */
export async function getCourseBySlug(env: any, slug: string): Promise<CourseEntry | undefined> {
  const decapEntry = await getDecapEntry(slug);

  let row: CourseRow | undefined;
  if (env?.DB) {
    row = (await env.DB.prepare(`SELECT * FROM courses WHERE slug = ?`).bind(slug).first()) as
      | CourseRow
      | undefined;
  }

  if (!row) return decapEntry;

  const data = rowToData(row);
  if (decapEntry) {
    // Migrated course: keep the original entry's renderable body, but the
    // metadata you see/edit in the Studio always wins.
    return { ...decapEntry, id: slug, data };
  }
  // A course created entirely in the Studio — no markdown file ever existed.
  return { id: slug, data, body: '', collection: 'courses' };
}

/** List every course, D1 rows merged over (and de-duplicated against) Decap entries. */
export async function listCourses(
  env: any,
  opts: { includeDrafts?: boolean } = {}
): Promise<CourseEntry[]> {
  const decapEntries = await getAllDecapEntries();
  const byId = new Map<string, CourseEntry>();
  for (const entry of decapEntries) {
    if (opts.includeDrafts || !entry.data.draft) byId.set(entry.id, entry);
  }

  if (env?.DB) {
    const rows = ((await env.DB.prepare(`SELECT * FROM courses`).all()).results || []) as CourseRow[];
    for (const row of rows) {
      const data = rowToData(row);
      if (!opts.includeDrafts && data.draft) {
        byId.delete(row.slug);
        continue;
      }
      const existing = byId.get(row.slug) || decapEntries.find((e) => e.id === row.slug);
      byId.set(
        row.slug,
        existing ? { ...existing, id: row.slug, data } : { id: row.slug, data, body: '', collection: 'courses' }
      );
    }
  }

  return [...byId.values()];
}

/** True once a course has at least one D1 courses row (i.e. is Studio-managed). */
export async function isStudioManaged(env: any, slug: string): Promise<boolean> {
  if (!env?.DB) return false;
  const row = await env.DB.prepare(`SELECT slug FROM courses WHERE slug = ?`).bind(slug).first();
  return !!row;
}

export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .trim()
      .replace(/['"]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 90) || `course-${Date.now()}`
  );
}

export async function generateUniqueSlug(env: any, title: string): Promise<string> {
  const base = slugify(title);
  let slug = base;
  let i = 2;
  // Check against both D1 and Decap so we never collide with either source.
  while (await getCourseBySlug(env, slug)) {
    slug = `${base}-${i++}`;
  }
  return slug;
}

export interface CourseInput {
  title: string;
  description: string;
  category: string;
  estimatedHours: number;
  author: string;
  isPaid: boolean;
  pricePkr?: number | null;
  passScorePercent: number;
  image?: string | null;
  imageAlt?: string | null;
  draft: boolean;
}

export async function createCourse(env: any, slug: string, input: CourseInput): Promise<void> {
  const now = new Date().toISOString();
  const max = await env.DB.prepare(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM courses`).first<{ m: number }>();
  await env.DB.prepare(
    `INSERT INTO courses
      (slug, title, description, category, estimated_hours, author, is_paid, price_pkr, pass_score_percent, quiz, image, image_alt, sort_order, draft, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, 'studio', ?, ?)`
  )
    .bind(
      slug,
      input.title,
      input.description || '',
      input.category || 'general',
      input.estimatedHours || 1,
      input.author || '',
      input.isPaid ? 1 : 0,
      input.pricePkr ?? null,
      input.passScorePercent || 80,
      input.image ?? null,
      input.imageAlt ?? null,
      (max?.m ?? -1) + 1,
      input.draft ? 1 : 0,
      now,
      now
    )
    .run();
}

export async function updateCourse(env: any, slug: string, patch: Record<string, any>): Promise<void> {
  const columnMap: Record<string, string> = {
    title: 'title',
    description: 'description',
    category: 'category',
    estimatedHours: 'estimated_hours',
    author: 'author',
    isPaid: 'is_paid',
    pricePkr: 'price_pkr',
    passScorePercent: 'pass_score_percent',
    quiz: 'quiz',
    image: 'image',
    imageAlt: 'image_alt',
    order: 'sort_order',
    draft: 'draft',
  };
  const fields: Record<string, any> = {};
  for (const [key, col] of Object.entries(columnMap)) {
    if (!(key in patch)) continue;
    let value = patch[key];
    if (key === 'isPaid' || key === 'draft') value = value ? 1 : 0;
    if (key === 'quiz') value = JSON.stringify(value || []);
    fields[col] = value;
  }
  if (Object.keys(fields).length === 0) return;
  fields.updated_at = new Date().toISOString();

  // If this course doesn't have a D1 row yet (still Decap-only), seed one
  // from its current merged data first, so a partial edit doesn't wipe out
  // fields the admin didn't touch in this request.
  const existing = await env.DB.prepare(`SELECT slug FROM courses WHERE slug = ?`).bind(slug).first();
  if (!existing) {
    const current = await getCourseBySlug(env, slug);
    if (!current) throw new Error('Course not found');
    await createCourse(env, slug, {
      title: current.data.title,
      description: current.data.description,
      category: current.data.category,
      estimatedHours: current.data.estimatedHours,
      author: current.data.author,
      isPaid: current.data.isPaid,
      pricePkr: current.data.pricePkr ?? null,
      passScorePercent: current.data.passScorePercent,
      image: current.data.image ?? null,
      imageAlt: current.data.imageAlt ?? null,
      draft: current.data.draft,
    });
    await env.DB.prepare(`UPDATE courses SET quiz = ? WHERE slug = ?`)
      .bind(JSON.stringify(current.data.quiz || []), slug)
      .run();
  }

  const setClause = Object.keys(fields)
    .map((k) => `${k} = ?`)
    .join(', ');
  await env.DB.prepare(`UPDATE courses SET ${setClause} WHERE slug = ?`)
    .bind(...Object.values(fields), slug)
    .run();
}
