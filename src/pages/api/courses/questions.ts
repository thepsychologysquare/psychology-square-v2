import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getCollection } from 'astro:content';
import { getClientSession } from '../../../lib/clientAuth';

export const prerender = false;

// GET /api/courses/questions?course=slug -- published Q&A only, public,
// no auth required (same spirit as the certificate verify page).
export const GET: APIRoute = async ({ url }) => {
  if (!env?.DB) return new Response(JSON.stringify({ questions: [] }), { status: 200, headers: { 'content-type': 'application/json' } });

  const courseSlug = url.searchParams.get('course') || '';
  if (!courseSlug) return new Response(JSON.stringify({ error: 'Missing course.' }), { status: 400 });

  const { results } = await env.DB.prepare(
    `SELECT id, question, answer, step_title, created_at, answered_at
     FROM course_questions WHERE course_slug = ? AND status = 'published'
     ORDER BY answered_at DESC LIMIT 200`
  ).bind(courseSlug).all();

  return new Response(JSON.stringify({ questions: results }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

// POST -- a signed-in learner submits a question. It stays invisible to
// everyone (including other learners) until an admin answers and
// publishes it -- this is moderated Q&A, not an open comment thread.
export const POST: APIRoute = async ({ request }) => {
  if (!env?.DB || !env?.CLIENT_SESSION_SECRET) {
    return new Response(JSON.stringify({ error: 'Q&A is not configured yet.' }), { status: 500 });
  }

  const session = await getClientSession(request.headers.get('cookie'), env.CLIENT_SESSION_SECRET);
  if (!session) return new Response(JSON.stringify({ error: 'Please sign in first.' }), { status: 401 });

  const body = await request.json().catch(() => null);
  const courseSlug = typeof body?.courseSlug === 'string' ? body.courseSlug.trim() : '';
  const stepId = typeof body?.stepId === 'string' ? body.stepId.trim() : '';
  const stepTitle = typeof body?.stepTitle === 'string' ? body.stepTitle.trim() : '';
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const question = typeof body?.question === 'string' ? body.question.trim() : '';

  if (!courseSlug) return new Response(JSON.stringify({ error: 'Missing course.' }), { status: 400 });
  if (!name || name.length > 200) return new Response(JSON.stringify({ error: 'Please enter your name.' }), { status: 400 });
  if (!question || question.length < 5 || question.length > 2000) {
    return new Response(JSON.stringify({ error: 'Please write a question (5-2000 characters).' }), { status: 400 });
  }

  const courses = await getCollection('courses', ({ data }) => !data.draft);
  const course = courses.find((c) => c.id === courseSlug);
  if (!course) return new Response(JSON.stringify({ error: 'Course not found.' }), { status: 404 });

  await env.DB.prepare(
    `INSERT INTO course_questions (id, course_slug, course_title, step_id, step_title, name, email, question, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
  ).bind(
    crypto.randomUUID(), courseSlug, course.data.title, stepId || null, stepTitle || null,
    name, session.email, question, new Date().toISOString()
  ).run();

  return new Response(JSON.stringify({ ok: true }), {
    status: 201,
    headers: { 'content-type': 'application/json' },
  });
};
