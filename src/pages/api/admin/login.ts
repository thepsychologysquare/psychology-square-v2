import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { createSessionCookie, type Role } from '../../../lib/adminAuth';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const sessionSecret = env?.ADMIN_SESSION_SECRET;
  if (!sessionSecret || !env?.ADMIN_PASSWORD || !env?.SOHAIL_PASSWORD || !env?.SEHAR_PASSWORD) {
    return new Response(JSON.stringify({ error: 'Admin login is not configured yet.' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  const body = await request.json().catch(() => null);
  const password = body?.password;
  const identity = body?.identity; // 'admin' | 'sohail' | 'sehar' — chosen explicitly by the person logging in

  if (typeof password !== 'string' || (identity !== 'admin' && identity !== 'sohail' && identity !== 'sehar')) {
    return new Response(JSON.stringify({ error: 'Incorrect password.' }), { status: 401 });
  }

  // Check the password only against the identity that was explicitly picked —
  // no more inferring who you are from whichever password happens to match.
  const expected = identity === 'admin' ? env.ADMIN_PASSWORD : identity === 'sohail' ? env.SOHAIL_PASSWORD : env.SEHAR_PASSWORD;
  if (password !== expected) {
    return new Response(JSON.stringify({ error: 'Incorrect password.' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  const role = identity as Role;
  const cookie = await createSessionCookie(sessionSecret, role);
  return new Response(JSON.stringify({ ok: true, role }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'set-cookie': cookie },
  });
};
