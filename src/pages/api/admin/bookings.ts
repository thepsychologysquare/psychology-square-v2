import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getSession } from '../../../lib/adminAuth';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const session = await getSession(request.headers.get('cookie'), env?.ADMIN_SESSION_SECRET || '');
  if (!session) return new Response(JSON.stringify({ error: 'Not signed in.' }), { status: 401 });

  const query = session.role === 'admin'
    ? `SELECT id, created_at, client_name, contact, service, clinician, preferred_time,
              notes, amount_pkr, payment_method, screenshot_type, status
       FROM bookings ORDER BY created_at DESC LIMIT 500`
    : `SELECT id, created_at, client_name, contact, service, clinician, preferred_time,
              notes, amount_pkr, payment_method, screenshot_type, status
       FROM bookings WHERE clinician = ? ORDER BY created_at DESC LIMIT 500`;

  const stmt = session.role === 'admin'
    ? env.DB.prepare(query)
    : env.DB.prepare(query).bind(session.role);

  const { results } = await stmt.all();
  return new Response(JSON.stringify({ bookings: results, role: session.role }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

const VALID_STATUSES = new Set(['pending', 'confirmed', 'declined']);

export const PATCH: APIRoute = async ({ request }) => {
  const session = await getSession(request.headers.get('cookie'), env?.ADMIN_SESSION_SECRET || '');
  if (!session) return new Response(JSON.stringify({ error: 'Not signed in.' }), { status: 401 });

  const body = await request.json().catch(() => null);
  const id = body?.id;
  const status = body?.status;
  if (typeof id !== 'string' || !VALID_STATUSES.has(status)) {
    return new Response(JSON.stringify({ error: 'Invalid request.' }), { status: 400 });
  }

  // Clinicians may only touch their own bookings; admin may touch any.
  if (session.role === 'admin') {
    await env.DB.prepare(`UPDATE bookings SET status = ? WHERE id = ?`).bind(status, id).run();
  } else {
    const result = await env.DB.prepare(
      `UPDATE bookings SET status = ? WHERE id = ? AND clinician = ?`
    ).bind(status, id, session.role).run();
    if (!result.meta.changes) {
      return new Response(JSON.stringify({ error: 'Not found.' }), { status: 404 });
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
