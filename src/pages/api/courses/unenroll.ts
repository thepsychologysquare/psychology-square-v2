import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getClientSession } from '../../../lib/clientAuth';

export const prerender = false;

// Unenrolling from an in-progress course. This is a status change, not a
// delete: the enrollments row stays (with all its lesson progress and past
// quiz attempts), status flips to 'unenrolled', and unenrolled_at records
// when -- so it still shows up in the admin "Course Enrollments" table.
// The free-course cap counts only 'active' rows, so the slot frees itself.
//
// Blocked in two cases:
//   - paid courses (would throw away a payment; there's no unenroll button
//     for these, and the server refuses regardless)
//   - courses the learner has already completed (a certificate exists) --
//     completed courses can't be redone, so there's nothing to "drop"

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function see(request: Request, path: string) {
  return new Response(null, { status: 303, headers: { location: new URL(path, request.url).toString() } });
}

const coursePath = (slug: string, error?: string) =>
  `/courses/${encodeURIComponent(slug)}/${error ? `?unenrollError=${error}` : ''}`;

export const POST: APIRoute = async ({ request }) => {
  const isJson = (request.headers.get('content-type') || '').includes('application/json');

  const fail = (slug: string, error: string, message: string, status: number) =>
    isJson ? json({ error: message, code: error }, status) : see(request, slug ? coursePath(slug, error) : '/courses/');

  if (!env?.DB || !env?.CLIENT_SESSION_SECRET) {
    return isJson ? json({ error: 'Enrollment is not configured yet.' }, 500) : see(request, '/courses/');
  }

  const origin = request.headers.get('origin');
  if (origin && new URL(origin).host !== new URL(request.url).host) {
    return json({ error: 'Cross-site request blocked.' }, 403);
  }

  let courseSlug = '';
  if (isJson) {
    const body = await request.json().catch(() => null);
    courseSlug = typeof body?.courseSlug === 'string' ? body.courseSlug : '';
  } else {
    const form = await request.formData().catch(() => null);
    courseSlug = typeof form?.get('courseSlug') === 'string' ? (form!.get('courseSlug') as string) : '';
  }
  if (!courseSlug) return isJson ? json({ error: 'Missing course.' }, 400) : see(request, '/courses/');

  const session = await getClientSession(request.headers.get('cookie'), env.CLIENT_SESSION_SECRET);
  if (!session) {
    return isJson ? json({ error: 'Please sign in first.' }, 401) : see(request, `/courses/${encodeURIComponent(courseSlug)}/`);
  }
  const email = session.email.trim().toLowerCase();

  const enrollment = await env.DB.prepare(
    `SELECT status, amount_pkr FROM enrollments WHERE course_slug = ? AND email = ?`
  ).bind(courseSlug, email).first<{ status: string; amount_pkr: number | null }>();

  if (!enrollment || enrollment.status !== 'active') {
    return fail(courseSlug, 'not_active', 'You\u2019re not currently enrolled in this course.', 409);
  }
  if (enrollment.amount_pkr !== null) {
    return fail(courseSlug, 'paid', 'Paid courses can\u2019t be unenrolled from here \u2014 contact us if you need help.', 400);
  }

  const certificate = await env.DB.prepare(
    `SELECT 1 FROM certificates WHERE course_slug = ? AND email = ?`
  ).bind(courseSlug, email).first();
  if (certificate) {
    return fail(courseSlug, 'completed', 'You\u2019ve already completed this course, so it can\u2019t be unenrolled.', 400);
  }

  await env.DB.prepare(
    `UPDATE enrollments SET status = 'unenrolled', unenrolled_at = ? WHERE course_slug = ? AND email = ? AND status = 'active'`
  ).bind(new Date().toISOString(), courseSlug, email).run();

  return isJson ? json({ ok: true }, 200) : see(request, coursePath(courseSlug));
};
