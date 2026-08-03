import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { consumeMagicLinkToken } from '../../../lib/magicLink';
import { createClientSessionCookie } from '../../../lib/clientAuth';

export const prerender = false;

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// POST-only, and only ever called by an explicit button click on the
// /certificates/verify confirmation page -- never by the bare emailed link
// itself. Email providers and corporate security gateways routinely
// pre-fetch links inside emails to scan them for safety before a person
// ever clicks; if this endpoint consumed the token on GET, that automated
// visit would burn the one-time token and the real click would always
// come back "expired." Requiring a real click (a JS-initiated POST) means
// scanners that merely fetch the page never trigger it.
export const POST: APIRoute = async ({ request }) => {
  if (!env?.DB || !env?.CLIENT_SESSION_SECRET) {
    return jsonError('Sign-in is not configured yet.', 500);
  }

  const body = await request.json().catch(() => null);
  const token = typeof body?.token === 'string' ? body.token : '';

  const payload = await consumeMagicLinkToken(env.DB, token);
  if (!payload) {
    return jsonError('That link has expired or was already used. Please request a new one.', 400);
  }

  // If this login was to enroll in a course, create the enrollment now --
  // the person has just proven they own this email address. Paid courses
  // are the exception: enrollment there is created by the payment-proof
  // submission (/api/courses/pay) instead, starting out 'pending' until
  // reviewed -- signing in alone should never unlock a paid course's lessons.
  if (payload.enrollCourseSlug && payload.enrollName) {
    const { getCourseBySlug } = await import('../../../lib/courses');
    const course = await getCourseBySlug(env, payload.enrollCourseSlug);
    if (!course?.data.isPaid) {
      await env.DB.prepare(
        `INSERT INTO enrollments (course_slug, course_title, name, email, enrolled_at, status)
         VALUES (?, ?, ?, ?, ?, 'active')
         ON CONFLICT(course_slug, email) DO NOTHING`
      ).bind(
        payload.enrollCourseSlug,
        course?.data.title || payload.enrollCourseSlug,
        payload.enrollName,
        payload.email,
        new Date().toISOString()
      ).run();
    }
  }

  const cookie = await createClientSessionCookie(env.CLIENT_SESSION_SECRET, payload.email);
  return new Response(JSON.stringify({ ok: true, redirectPath: payload.redirectPath || '/my-certificates' }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'set-cookie': cookie },
  });
};
