import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getCollection } from 'astro:content';
import { getClientSession } from '../../../lib/clientAuth';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  if (!env?.DB || !env?.CLIENT_SESSION_SECRET) {
    return new Response(JSON.stringify({ error: 'Enrollment is not configured yet.' }), { status: 500 });
  }

  const session = await getClientSession(request.headers.get('cookie'), env.CLIENT_SESSION_SECRET);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Please sign in first.' }), { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const courseSlug = typeof body?.courseSlug === 'string' ? body.courseSlug : '';
  if (!courseSlug) {
    return new Response(JSON.stringify({ error: 'Missing course.' }), { status: 400 });
  }

  const courses = await getCollection('courses', ({ data }) => !data.draft);
  const course = courses.find((c) => c.id === courseSlug);
  if (!course) {
    return new Response(JSON.stringify({ error: 'Course not found.' }), { status: 404 });
  }

  // Re-use the name from a prior enrollment if there is one, so we're not
  // asking for it again just because they didn't type it this time.
  const priorName = await env.DB.prepare(
    `SELECT name FROM enrollments WHERE email = ? ORDER BY enrolled_at DESC LIMIT 1`
  ).bind(session.email).first<{ name: string }>();

  await env.DB.prepare(
    `INSERT INTO enrollments (course_slug, course_title, name, email, enrolled_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(course_slug, email) DO NOTHING`
  ).bind(courseSlug, course.data.title, priorName?.name || session.email, session.email, new Date().toISOString()).run();

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
