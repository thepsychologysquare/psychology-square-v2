export const prerender = false;
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getSession } from '../../../lib/adminAuth';
import {
  createCourse,
  generateUniqueSlug,
  getCourseBySlug,
  listCourses,
  updateCourse,
} from '../../../lib/courses';

async function requireAdmin(request: Request) {
  return getSession(request.headers.get('cookie'), env?.ADMIN_SESSION_SECRET || '');
}

export const GET: APIRoute = async ({ request, url }) => {
  if (!(await requireAdmin(request))) return new Response('Unauthorized', { status: 401 });
  const slug = url.searchParams.get('slug');

  if (slug) {
    const course = await getCourseBySlug(env, slug);
    if (!course) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
    return new Response(JSON.stringify({ id: course.id, data: course.data }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  const courses = await listCourses(env, { includeDrafts: true });
  let counts = new Map<string, number>();
  if (env?.DB) {
    const rows = (await env.DB.prepare(`SELECT course_slug, COUNT(*) AS n FROM course_modules GROUP BY course_slug`).all())
      .results as { course_slug: string; n: number }[];
    counts = new Map(rows.map((r) => [r.course_slug, r.n]));
  }
  const payload = courses
    .sort((a, b) => a.data.order - b.data.order)
    .map((c) => ({ id: c.id, data: c.data, moduleCount: counts.get(c.id) || 0 }));
  return new Response(JSON.stringify({ courses: payload }), { headers: { 'content-type': 'application/json' } });
};

export const POST: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) return new Response('Unauthorized', { status: 401 });
  if (!env?.DB) return new Response(JSON.stringify({ error: 'Database unavailable' }), { status: 500 });

  const body = await request.json();
  const title = (body.title || '').trim();
  if (!title) return new Response(JSON.stringify({ error: 'Title is required' }), { status: 400 });

  const slug = body.slug ? String(body.slug).trim() : await generateUniqueSlug(env, title);
  const alreadyExists = await getCourseBySlug(env, slug);
  if (alreadyExists) {
    return new Response(JSON.stringify({ error: `A course with slug "${slug}" already exists.` }), { status: 409 });
  }

  await createCourse(env, slug, {
    title,
    description: body.description || '',
    category: body.category || 'general',
    estimatedHours: Number(body.estimatedHours) || 1,
    author: body.author || '',
    isPaid: !!body.isPaid,
    pricePkr: body.isPaid ? Number(body.pricePkr) || 0 : null,
    passScorePercent: Number(body.passScorePercent) || 80,
    image: body.image || null,
    imageAlt: body.imageAlt || null,
    draft: body.draft !== false,
  });

  return new Response(JSON.stringify({ slug }), { status: 201, headers: { 'content-type': 'application/json' } });
};

export const PATCH: APIRoute = async ({ request }) => {
  const session = await requireAdmin(request);
  if (!session) return new Response('Unauthorized', { status: 401 });
  if (!env?.DB) return new Response(JSON.stringify({ error: 'Database unavailable' }), { status: 500 });

  const body = await request.json();
  const { slug, ...patch } = body;
  if (!slug) return new Response(JSON.stringify({ error: 'slug is required' }), { status: 400 });

  const course = await getCourseBySlug(env, slug);
  if (!course) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });

  await updateCourse(env, slug, patch);
  return new Response(JSON.stringify({ ok: true }));
};
