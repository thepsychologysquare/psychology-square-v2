import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getSession } from '../../../lib/adminAuth';

export const prerender = false;

function canManage(role: string, clinician: string) {
  return role === 'admin' || role === clinician;
}

export const GET: APIRoute = async ({ request, url }) => {
  const session = await getSession(request.headers.get('cookie'), env?.ADMIN_SESSION_SECRET || '');
  if (!session) return new Response(JSON.stringify({ error: 'Not signed in.' }), { status: 401 });

  const requested = url.searchParams.get('clinician');
  const clinician = session.role === 'admin' ? requested : session.role;

  const query = clinician
    ? `SELECT id, clinician, date, time, status FROM availability_slots WHERE clinician = ? ORDER BY date, time`
    : `SELECT id, clinician, date, time, status FROM availability_slots ORDER BY date, time`;
  const stmt = clinician ? env.DB.prepare(query).bind(clinician) : env.DB.prepare(query);
  const { results } = await stmt.all();

  return new Response(JSON.stringify({ slots: results }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

// Body: { clinician: 'sohail'|'sehar', dates: ['2026-08-01', ...], times: ['09:00', '10:00', ...] }
// Creates one open slot per date x time combination (skips ones that already exist).
export const POST: APIRoute = async ({ request }) => {
  const session = await getSession(request.headers.get('cookie'), env?.ADMIN_SESSION_SECRET || '');
  if (!session) return new Response(JSON.stringify({ error: 'Not signed in.' }), { status: 401 });

  const body = await request.json().catch(() => null);
  const clinician = body?.clinician;
  const dates: string[] = Array.isArray(body?.dates) ? body.dates : [];
  const times: string[] = Array.isArray(body?.times) ? body.times : [];

  if (!canManage(session.role, clinician)) {
    return new Response(JSON.stringify({ error: 'Not authorized for that clinician.' }), { status: 403 });
  }
  if (!dates.length || !times.length) {
    return new Response(JSON.stringify({ error: 'Pick at least one date and one time.' }), { status: 400 });
  }

  const statements = [];
  for (const date of dates.slice(0, 60)) {
    for (const time of times.slice(0, 20)) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO availability_slots (clinician, date, time, status)
           SELECT ?, ?, ?, 'open'
           WHERE NOT EXISTS (
             SELECT 1 FROM availability_slots WHERE clinician = ? AND date = ? AND time = ?
           )`
        ).bind(clinician, date, time, clinician, date, time)
      );
    }
  }
  await env.DB.batch(statements);

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

  const slot = await env.DB.prepare(`SELECT clinician, status FROM availability_slots WHERE id = ?`)
    .bind(id).first<{ clinician: string; status: string }>();
  if (!slot) return new Response(JSON.stringify({ error: 'Not found.' }), { status: 404 });
  if (!canManage(session.role, slot.clinician)) {
    return new Response(JSON.stringify({ error: 'Not authorized.' }), { status: 403 });
  }
  if (slot.status === 'booked') {
    return new Response(JSON.stringify({ error: 'Cannot remove a slot that has already been booked.' }), { status: 400 });
  }

  await env.DB.prepare(`DELETE FROM availability_slots WHERE id = ?`).bind(id).run();
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
