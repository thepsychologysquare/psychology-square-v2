import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getSession } from '../../../lib/adminAuth';
import { sendCourseEnrollmentStatusEmail } from '../../../lib/email';

export const prerender = false;

// Paid-course enrollment requests -- the same review queue pattern as
// bookings, but for course payment screenshots instead of session ones.
// Only rows with actual payment data (i.e. came through /api/courses/pay)
// show up here; free-course enrollments never have amount_pkr set.
export const GET: APIRoute = async ({ request }) => {
  const session = await getSession(request.headers.get('cookie'), env?.ADMIN_SESSION_SECRET || '');
  if (!session) return new Response(JSON.stringify({ error: 'Not signed in.' }), { status: 401 });

  const { results } = await env.DB.prepare(
    `SELECT id, course_slug, course_title, name, email, status, amount_pkr, payment_method,
            screenshot_type, payment_submitted_at, reviewed_at
     FROM enrollments
     WHERE amount_pkr IS NOT NULL
     ORDER BY payment_submitted_at DESC LIMIT 500`
  ).all();

  return new Response(JSON.stringify({ requests: results }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

const VALID_STATUSES = new Set(['active', 'declined']);

export const PATCH: APIRoute = async ({ request }) => {
  const session = await getSession(request.headers.get('cookie'), env?.ADMIN_SESSION_SECRET || '');
  if (!session) return new Response(JSON.stringify({ error: 'Not signed in.' }), { status: 401 });

  const body = await request.json().catch(() => null);
  const id = Number(body?.id);
  const status = body?.status;
  if (!Number.isInteger(id) || !VALID_STATUSES.has(status)) {
    return new Response(JSON.stringify({ error: 'Invalid request.' }), { status: 400 });
  }

  const updated = await env.DB.prepare(
    `UPDATE enrollments SET status = ?, reviewed_at = ? WHERE id = ? AND amount_pkr IS NOT NULL
     RETURNING id, course_slug, course_title, name, email, status`
  ).bind(status, new Date().toISOString(), id).first<{
    id: number; course_slug: string; course_title: string; name: string; email: string; status: string;
  }>();

  if (!updated) {
    return new Response(JSON.stringify({ error: 'Not found.' }), { status: 404 });
  }

  // Best-effort -- a failed notification email should never block the
  // status update itself, which has already been saved.
  const courseUrl = new URL(`/courses/${updated.course_slug}`, request.url).toString();
  await sendCourseEnrollmentStatusEmail(env, {
    toEmail: updated.email,
    toName: updated.name,
    courseTitle: updated.course_title,
    status: status as 'active' | 'declined',
    courseUrl,
  }).catch(() => {});

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
