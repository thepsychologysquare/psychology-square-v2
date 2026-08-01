import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { createMagicLinkToken } from '../../../lib/magicLink';
import { sendMagicLinkEmail } from '../../../lib/email';

export const prerender = false;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RATE_LIMIT_WINDOW_MINUTES = 10;
const RATE_LIMIT_MAX_REQUESTS = 5;

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export const POST: APIRoute = async ({ request }) => {
  if (!env?.DB) {
    return jsonError('Sign-in is not configured yet.', 500);
  }

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const redirectPath = typeof body?.redirect === 'string' && body.redirect.startsWith('/') ? body.redirect : undefined;
  const enrollCourseSlug = typeof body?.enrollCourseSlug === 'string' ? body.enrollCourseSlug : undefined;
  const enrollName = typeof body?.enrollName === 'string' ? body.enrollName.trim().slice(0, 200) : undefined;

  if (!EMAIL_RE.test(email) || email.length > 200) {
    return jsonError('Please enter a valid email address.', 400);
  }
  if (enrollCourseSlug && !enrollName) {
    return jsonError('Please enter your name.', 400);
  }

  // Lightweight rate limit: block if this email already has several
  // outstanding (unexpired, unconsumed) tokens — a proxy for "requested a
  // link 5 times in the last 15 minutes."
  const recent = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM magic_link_tokens WHERE email = ? AND expires_at > ?`
  ).bind(email, new Date().toISOString()).first<{ count: number }>();
  if (recent && recent.count >= RATE_LIMIT_MAX_REQUESTS) {
    return jsonError('Too many requests. Please try again in a few minutes.', 429);
  }

  const token = await createMagicLinkToken(env.DB, { email, redirectPath, enrollCourseSlug, enrollName });
  const link = new URL(`/api/certificates/verify?token=${token}`, request.url).toString();

  // Always respond the same way whether or not this email has anything
  // on file — don't let this endpoint be used to probe which addresses exist.
  await sendMagicLinkEmail(env, {
    toEmail: email,
    link,
    purpose: enrollCourseSlug ? 'enroll' : 'view-certificates',
  });

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
