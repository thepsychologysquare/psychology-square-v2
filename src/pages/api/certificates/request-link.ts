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
  if (!env?.SESSION) {
    return jsonError('Certificate lookup is not configured yet.', 500);
  }

  const body = await request.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(email) || email.length > 200) {
    return jsonError('Please enter a valid email address.', 400);
  }

  // Lightweight per-email rate limit using the same KV, so this endpoint
  // can't be used to spam an inbox.
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const rateLimitKey = `magiclink-rl:${ip}`;
  const recent = await env.SESSION.get(rateLimitKey);
  const count = recent ? Number(recent) : 0;
  if (count >= RATE_LIMIT_MAX_REQUESTS) {
    return jsonError('Too many requests. Please try again in a few minutes.', 429);
  }
  await env.SESSION.put(rateLimitKey, String(count + 1), { expirationTtl: RATE_LIMIT_WINDOW_MINUTES * 60 });

  const token = await createMagicLinkToken(env.SESSION, email);
  const link = new URL(`/api/certificates/verify?token=${token}`, request.url).toString();

  // Always respond the same way whether or not this email has any
  // certificates on file — don't let this endpoint be used to probe
  // which addresses are in the system.
  await sendMagicLinkEmail(env, { toEmail: email, link });

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
