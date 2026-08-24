import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { getSession } from '../../../lib/adminAuth';
import { sendWorkshopEnrollmentStatusEmail } from '../../../lib/email';

export const prerender = false;

// Same review-queue pattern as /api/admin/course-enrollments.ts, scoped to
// workshop_enrollments instead. Optional ?slug= filters to one workshop
// (used by the workshop detail page in the studio); omitted shows every
// pending request across all workshops.
export const GET: APIRoute = async ({ request, url }) => {
  const session = await getSession(request.headers.get('cookie'), env?.ADMIN_SESSION_SECRET || '');
  if (!session) return new Response(JSON.stringify({ error: 'Not signed in.' }), { status: 401 });

  const slug = url.searchParams.get('slug');
  const { results } = slug
    ? await env.DB.prepare(
        `SELECT id, workshop_slug, workshop_title, name, email, phone, notes, status, amount_pkr, payment_method,
                screenshot_type, created_at, reviewed_at
         FROM workshop_enrollments WHERE workshop_slug = ? ORDER BY created_at DESC LIMIT 500`
      ).bind(slug).all()
    : await env.DB.prepare(
        `SELECT id, workshop_slug, workshop_title, name, email, phone, notes, status, amount_pkr, payment_method,
                screenshot_type, created_at, reviewed_at
         FROM workshop_enrollments ORDER BY created_at DESC LIMIT 500`
      ).all();

  return new Response(JSON.stringify({ requests: results }), { status: 200, headers: { 'content-type': 'application/json' } });
};

const VALID_STATUSES = new Set(['active', 'declined']);

export const PATCH: APIRoute = async ({ request }) => {
  const session = await getSession(request.headers.get('cookie'), env?.ADMIN_SESSION_SECRET || '');
  if (!session) return new Response(JSON.stringify({ error: 'Not signed in.' }), { status: 401 });

  const body = await request.json().catch(() => null);
  const id = typeof body?.id === 'string' ? body.id : '';
  const status = body?.status;
  if (!id || !VALID_STATUSES.has(status)) {
    return new Response(JSON.stringify({ error: 'Invalid request.' }), { status: 400 });
  }

  const updated = await env.DB.prepare(
    `UPDATE workshop_enrollments SET status = ?, reviewed_at = ? WHERE id = ?
     RETURNING id, workshop_slug, workshop_title, name, email, status`
  ).bind(status, new Date().toISOString(), id).first<{
    id: string; workshop_slug: string; workshop_title: string; name: string; email: string; status: string;
  }>();

  if (!updated) {
    return new Response(JSON.stringify({ error: 'Not found.' }), { status: 404 });
  }

  await sendWorkshopEnrollmentStatusEmail(env, {
    toEmail: updated.email, toName: updated.name, workshopTitle: updated.workshop_title,
    status: status as 'active' | 'declined',
  }).catch(() => {});

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
};

export const DELETE: APIRoute = async ({ request, url }) => {
  const session = await getSession(request.headers.get('cookie'), env?.ADMIN_SESSION_SECRET || '');
  if (!session) return new Response(JSON.stringify({ error: 'Not signed in.' }), { status: 401 });

  const id = url.searchParams.get('id');
  if (!id) return new Response(JSON.stringify({ error: 'Missing id.' }), { status: 400 });

  const row = await env.DB.prepare(
    `SELECT screenshot_key FROM workshop_enrollments WHERE id = ?`
  ).bind(id).first<{ screenshot_key: string | null }>();

  await env.DB.prepare(`DELETE FROM workshop_enrollments WHERE id = ?`).bind(id).run();
  if (row?.screenshot_key) {
    await env.SCREENSHOTS.delete(row.screenshot_key).catch(() => {});
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
};
