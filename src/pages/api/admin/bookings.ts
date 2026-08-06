import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getSession } from '../../../lib/adminAuth';
import { sendBookingStatusEmail } from '../../../lib/email';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const session = await getSession(request.headers.get('cookie'), env?.ADMIN_SESSION_SECRET || '');
  if (!session) return new Response(JSON.stringify({ error: 'Not signed in.' }), { status: 401 });

  const query = session.role === 'admin'
    ? `SELECT id, created_at, client_name, email, phone, service, clinician, preferred_time,
              notes, amount_pkr, payment_method, screenshot_type, status, mode
       FROM bookings ORDER BY created_at DESC LIMIT 500`
    : `SELECT id, created_at, client_name, email, phone, service, clinician, preferred_time,
              notes, amount_pkr, payment_method, screenshot_type, status, mode
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
  // RETURNING gives us the updated row back in the same query, so we know
  // exactly who to email without a second round trip.
  const returning = `RETURNING id, client_name, email, phone, service, clinician, preferred_time, mode, status`;
  const updated = session.role === 'admin'
    ? await env.DB.prepare(`UPDATE bookings SET status = ? WHERE id = ? ${returning}`)
        .bind(status, id).first<{ id: string; client_name: string; email: string; phone: string; service: string; clinician: string; preferred_time: string; mode: string; status: string }>()
    : await env.DB.prepare(`UPDATE bookings SET status = ? WHERE id = ? AND clinician = ? ${returning}`)
        .bind(status, id, session.role).first<{ id: string; client_name: string; email: string; phone: string; service: string; clinician: string; preferred_time: string; mode: string; status: string }>();

  if (!updated) {
    return new Response(JSON.stringify({ error: 'Not found.' }), { status: 404 });
  }

  // Best-effort — a failed notification email should never block the status
  // update itself, which has already been saved.
  if (status === 'confirmed' || status === 'declined') {
    await sendBookingStatusEmail(env, {
      toEmail: updated.email,
      toName: updated.client_name,
      status,
      service: updated.service,
      clinician: updated.clinician,
      mode: updated.mode,
      preferredTime: updated.preferred_time,
      reference: updated.id,
    }).catch(() => {});
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

export const DELETE: APIRoute = async ({ request, url }) => {
  const session = await getSession(request.headers.get('cookie'), env?.ADMIN_SESSION_SECRET || '');
  if (!session) return new Response(JSON.stringify({ error: 'Not signed in.' }), { status: 401 });

  const id = url.searchParams.get('id');
  if (!id) return new Response(JSON.stringify({ error: 'Missing id.' }), { status: 400 });

  const booking = await env.DB.prepare(
    `SELECT clinician, screenshot_key, slot_id FROM bookings WHERE id = ?`
  ).bind(id).first<{ clinician: string; screenshot_key: string; slot_id: number | null }>();

  if (!booking) return new Response(JSON.stringify({ error: 'Not found.' }), { status: 404 });
  if (session.role !== 'admin' && booking.clinician !== session.role) {
    return new Response(JSON.stringify({ error: 'Not authorized.' }), { status: 403 });
  }

  await env.DB.prepare(`DELETE FROM bookings WHERE id = ?`).bind(id).run();
  // Free the slot back up so it can be booked again, since this booking no longer exists.
  if (booking.slot_id) {
    await env.DB.prepare(`UPDATE availability_slots SET status = 'open' WHERE id = ?`).bind(booking.slot_id).run();
  }
  if (booking.screenshot_key) {
    await env.SCREENSHOTS.delete(booking.screenshot_key).catch(() => {});
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
