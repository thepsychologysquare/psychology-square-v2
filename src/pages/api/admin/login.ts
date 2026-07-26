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
  if (typeof password !== 'string') {
    return new Response(JSON.stringify({ error: 'Incorrect password.' }), { status: 401 });
  }

  let role: Role | null = null;
  if (password === env.ADMIN_PASSWORD) role = 'admin';
  else if (password === env.SOHAIL_PASSWORD) role = 'sohail';
  else if (password === env.SEHAR_PASSWORD) role = 'sehar';

  if (!role) {
    return new Response(JSON.stringify({ error: 'Incorrect password.' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  const cookie = await createSessionCookie(sessionSecret, role);
  return new Response(JSON.stringify({ ok: true, role }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'set-cookie': cookie },
  });
};
