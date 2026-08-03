import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getCourseBySlug } from '../../../lib/courses';

export const prerender = false;

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function ratingOf(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

// POST -- optional post-quiz feedback. No auth check beyond a valid course:
// the survey only appears after a learner already passed the quiz, and a
// stray or duplicate submission here carries no real downside, so we keep
// this endpoint simple rather than re-deriving enrollment state.
export const POST: APIRoute = async ({ request }) => {
  if (!env?.DB) return jsonError('Feedback is not configured yet.', 500);

  const body = await request.json().catch(() => null);
  const courseSlug = typeof body?.courseSlug === 'string' ? body.courseSlug.trim() : '';
  const certificateId = typeof body?.certificateId === 'string' ? body.certificateId.trim() : null;
  const clarity = ratingOf(body?.fb1);
  const usefulness = ratingOf(body?.fb2);
  const recommend = ratingOf(body?.fb3);

  if (!courseSlug) return jsonError('Missing course.', 400);
  if (clarity === null || usefulness === null || recommend === null) {
    return jsonError('Please answer all three questions.', 400);
  }

  const course = await getCourseBySlug(env, courseSlug);
  if (!course) return jsonError('Course not found.', 404);

  await env.DB.prepare(
    `INSERT INTO course_feedback (id, course_slug, course_title, certificate_id, clarity_rating, usefulness_rating, recommend_rating, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    crypto.randomUUID(), courseSlug, course.data.title, certificateId,
    clarity, usefulness, recommend, new Date().toISOString()
  ).run();

  return new Response(JSON.stringify({ ok: true }), {
    status: 201,
    headers: { 'content-type': 'application/json' },
  });
};
